'use client'

import { AthletePortsProvider } from '@fitnessos/core/athlete/presentation'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { createAthletePorts } from './athlete'
import { createHttp } from './container'

/**
 * Port providers for the authenticated area. Mounted by the `(app)` layout, NOT by
 * the root layout.
 *
 * That placement was forced by the bundle budget, and the finding is worth recording
 * because it will recur. Constructing the container pulls in `@fitnessos/infra`,
 * which pulls the mappers, which pull the generated Zod schemas and Zod itself. With
 * this in the root layout, adding response validation put 12.7 kB gz into the chunk
 * shared by *every* route — so a visitor to the marketing page downloaded the athlete
 * mapper and a validator for an endpoint they will never call. The budget failed, and
 * raising the number would have hidden a real problem rather than solved one.
 *
 * The general rule this establishes: **ports are provided by the route group that
 * uses them.** Two things follow, and the second matters more than the bundle:
 *
 *   - Code splits along the boundary that already exists. Public and auth routes carry
 *     no infrastructure at all, and adding contexts inflates only the groups that
 *     mount them, rather than every page on the site.
 *   - A context's ports are unreachable from a route group that has no business with
 *     them. `no-cross-context` holds at lint time; this makes the same statement true
 *     of the running application.
 *
 * When `(auth)` needs an OTP port it gets its own provider module here, on the same
 * terms. There is deliberately no single god container in Context.
 */
export const AppProviders = ({ children }: { children: ReactNode }) => {
  const router = useRouter()

  // A ref so `onSessionLost` closes over the router exactly once. Putting `router` in
  // the memo's dependency list would rebuild the whole container whenever the
  // router's identity changed, and the container must be a stable reference.
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])

  // React Context is used here for dependency injection only, so the value has to be
  // referentially stable. If it changed identity on re-render, every consumer of
  // every port would re-render with it and `useMyAthlete` would see a new `queryFn`
  // each time, defeating the cache. The React Compiler makes no promise about this —
  // it is a correctness requirement, not a memoisation opportunity.
  const ports = useMemo(
    () =>
      createAthletePorts(
        createHttp({
          mode: 'browser',
          onSessionLost: () => {
            // The refresh itself failed, so the session is genuinely gone. Send the
            // user to sign-in rather than leaving them on a page that will keep
            // 401ing every query it mounts.
            routerRef.current.replace('/sign-in')
          },
        }),
        // Browser requests carry cookies automatically, so no cookie to forward.
        {},
      ),
    [],
  )

  return <AthletePortsProvider value={ports}>{children}</AthletePortsProvider>
}
