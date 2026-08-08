'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { createQueryClient } from './query-client'

/**
 * The root client boundary: a QueryClient and nothing else.
 *
 * Deliberately does NOT construct the container. That split was forced by a
 * measurement, not a preference — see `app-providers.tsx`. This module's entire
 * dependency footprint is React and TanStack Query, both of which are in the shared
 * chunk already, so mounting it in the root layout costs a visitor nothing.
 *
 * The QueryClient is created in state rather than at module scope. A module-level
 * client is shared across every request a server process handles, which leaks one
 * user's cache into another's render. `useState(createQueryClient)` gives one per
 * browser session and one per server render — and it is passed the function itself,
 * not a call, since a call would build a fresh client on every render and discard
 * the cache.
 */
export const QueryProviders = ({ children }: { children: ReactNode }) => {
  const [queryClient] = useState(createQueryClient)
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
