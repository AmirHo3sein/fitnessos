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
      queries: {
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
      dehydrate: {
        // Include pending queries so a streamed RSC render can hand the browser a
        // promise that is still in flight, instead of the browser starting the
        // same request over.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
      },
    },
  })
