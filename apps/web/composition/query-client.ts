import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'

/**
 * QueryClient factory, shared by the server and the browser so that both sides of
 * a hydration boundary agree on the defaults. Divergent defaults are the usual
 * cause of "the prefetch worked but it refetched anyway".
 */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
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
