import {
  MutationCache,
  QueryCache,
  QueryClient,
  defaultShouldDehydrateQuery,
} from '@tanstack/react-query'
import type { TelemetryPort } from '@fitnessos/telemetry'
import { noopTelemetry } from '@fitnessos/telemetry'
import { classifyError } from './report-error'

/**
 * QueryClient factory, shared by the server and the browser so that both sides of
 * a hydration boundary agree on the defaults. Divergent defaults are the usual
 * cause of "the prefetch worked but it refetched anyway".
 */
/**
 * The route a failed query was for, recovered from its key.
 *
 * Query keys are arrays of literals by convention (`['athlete', 'mine']`), so this is
 * best-effort: enough to group failures by area, and structurally incapable of carrying a
 * value, since anything non-string is dropped rather than stringified. A key holding an id
 * would otherwise become part of the route template.
 */
const routeFromKey = (key: readonly unknown[]): string =>
  `/${key.filter((part): part is string => typeof part === 'string').join('/')}`

export const createQueryClient = (telemetry: TelemetryPort = noopTelemetry): QueryClient =>
  new QueryClient({
    /*
     * Reporting is wired to the CACHES, not to per-query `onError` callbacks.
     *
     * A cache-level handler fires for every query and mutation in the client, including
     * ones added later by code that has never heard of telemetry. Per-query callbacks
     * would have to be remembered at each call site, and the one that gets forgotten is
     * always the one that fails in production.
     *
     * `defaultTelemetry` is the noop, so a QueryClient built without a sink — every test,
     * and the server-side prefetch client — reports nothing and needs no stub.
     */
    queryCache: new QueryCache({
      onError: (error, query) => {
        telemetry.report(classifyError(error, 'query', routeFromKey(query.queryKey)))
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        // Mutations have no key by default, so the route is the mutation key when one was
        // set and null otherwise. Deliberately not derived from `variables`, which is
        // exactly where a phone number or a goal's text would be.
        const key = mutation.options.mutationKey
        telemetry.report(
          classifyError(error, 'mutation', key === undefined ? null : routeFromKey(key)),
        )
      },
    }),
    defaultOptions: {
      /*
       * `networkMode: 'always'` for BOTH queries and mutations — the single most consequential line
       * in this file, and it is here because the default silently breaks every offline interaction.
       *
       * TanStack Query defaults to `networkMode: 'online'`, which does not fail when the browser is
       * offline. It **pauses**. For a mutation that means `mutationFn` is never called, `isPending`
       * stays true forever, and the promise never settles — so a builder's save button sits disabled
       * with nothing on screen, indistinguishable from the app having ignored the press. For a query
       * with no cached data it means `isPending` stays true and the workspace shows its loading
       * skeleton indefinitely.
       *
       * Found by testing it: an e2e that puts the browser offline and presses save waited 15 seconds
       * for the "your changes were not saved" card that this app renders on every other failure, and
       * it never appeared. Twelve mutation sites were affected, including sign-in, onboarding and
       * goal declaration.
       *
       * It also contradicted an intent already written down. `useReviseProgram` says a save "must
       * fail while the author is looking at it rather than be paused and replayed against a programme
       * that has since moved" — correct, and the default it relied on does the opposite.
       *
       * ## Why global rather than per hook
       *
       * Because it is true of every mutation in this app except one, and of every query. These are
       * interactive actions with a person waiting: the honest response to "there is no network" is to
       * say so, not to hold the press and act on it later against state that has moved.
       *
       * The exception is session logging, which is queued deliberately (ADR-0033) and sets this
       * explicitly for its own reasons — it now agrees with the default rather than departing from
       * it, and its comment is worth reading for the difference between "queue this" and "fail now".
       *
       * The cost of `'always'`: a save attempted offline fails immediately rather than waiting for a
       * connection. That is the intended behaviour for an authored artefact — the edits stay in the
       * editor, the commit boundary does not move, and the author decides when to retry.
       */
      queries: {
        networkMode: 'always',
        // Non-zero on purpose. With staleTime: 0 the client refetches every
        // prefetched query immediately on mount, which makes the RSC prefetch
        // pure overhead — two requests for one render. Individual query
        // definitions override this where their data moves faster.
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Never retry an auth or client error. A 401 retried three times is
          // three chances to trip a rate limiter, and the answer will not change.
          const status = (error as { status?: number }).status
          if (status !== undefined && status >= 400 && status < 500) return false
          return failureCount < 2
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        networkMode: 'always',
      },
      dehydrate: {
        // Include pending queries so a streamed RSC render can hand the browser a
        // promise that is still in flight, instead of the browser starting the
        // same request over.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  })
