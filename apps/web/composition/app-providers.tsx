'use client'

import { AthletePortsProvider } from '@fitnessos/core/athlete/presentation'
import { GoalPortsProvider } from '@fitnessos/core/goal/presentation'
import { PrescriptionPortsProvider } from '@fitnessos/ctx-prescription/presentation'
import { ExecutionPortsProvider } from '@fitnessos/core/execution/presentation'
import { MeasurementPortsProvider } from '@fitnessos/ctx-measurement/presentation'
import { LearningPortsProvider } from '@fitnessos/core/learning/presentation'
import { ReportPortsProvider } from '@fitnessos/ctx-report/presentation'
import { DashboardPortsProvider } from '@fitnessos/ctx-dashboard/presentation'
import { TimelinePortsProvider } from '@fitnessos/ctx-timeline/presentation'
import { NutritionPortsProvider } from '@fitnessos/ctx-nutrition/presentation'
import { WorkflowPortsProvider } from '@fitnessos/ctx-workflow/presentation'
import { keysFor, openEventStream } from '@fitnessos/infra'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { createAthletePorts } from './athlete'
import { createGoalPorts } from './goal'
import { createPrescriptionPorts } from './prescription'
import { createExecutionPorts } from './execution'
import { createMeasurementPorts } from './measurement'
import { createLearningPorts } from './learning'
import { createReportPorts } from './report'
import { createDashboardPorts } from './dashboard'
import { createTimelinePorts } from './timeline'
import { createNutritionPorts } from './nutrition'
import { createWorkflowPorts } from './workflow'
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
  // Stable for the life of the provider above, so it can go in the memo's deps without rebuilding
  // the container — unlike `router`, whose identity changes on navigation.
  const queryClient = useQueryClient()

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
  const ports = useMemo(() => {
    const http = createHttp({
      mode: 'browser',
      onSessionLost: () => {
        // The refresh itself failed, so the session is genuinely gone. Send the user to
        // sign-in rather than leaving them on a page that will keep 401ing every query
        // it mounts.
        routerRef.current.replace('/sign-in')
      },
    })
    // One HTTP client, several contexts' ports. The client carries the refresh
    // single-flight state, so sharing it is not an optimisation — two clients would each
    // rotate the refresh token and revoke each other's session.
    //
    // Browser requests carry cookies automatically, so there is no cookie to forward.
    // Built before Prescription, because Prescription resolves goal references through it. The
    // dependency runs one way and lives entirely here: Development knows nothing of Prescription.
    const goal = createGoalPorts(http, {})

    return {
      /*
       * The client itself, alongside the ports.
       *
       * The event stream needs it — not to fetch, but to ask "is this session still alive?" through
       * the one object that knows how to answer: it single-flights a refresh on a 401 and calls
       * `onSessionLost` when the refresh itself fails. A second refresh path would rotate the token
       * behind this one's back and revoke the session it was trying to save.
       */
      http,
      athlete: createAthletePorts(http, {}),
      goal,
      prescription: createPrescriptionPorts(http, {}, goal),
      // Invalidates the issue query so a conflict recorded by a background drain appears without
      // the athlete reloading. The record itself is already durable — this only shortens the wait.
      measurement: createMeasurementPorts(http, {}),
      learning: createLearningPorts(http, {}),
      report: createReportPorts(http, {}),
      dashboardLayout: createDashboardPorts(http, {}),
      timeline: createTimelinePorts(http, {}),
      nutrition: createNutritionPorts(http, {}),
      workflow: createWorkflowPorts(http, {}),
      execution: createExecutionPorts(http, {}, () => {
        void queryClient.invalidateQueries({ queryKey: ['sync-issues'] })
      }),
    }
  }, [queryClient])

  /**
   * One event stream for the tab, and everything that follows from that being ONE.
   *
   * D-12's spike measured the ceiling: six connections per origin on HTTP/1.1, each stream holding
   * one for its whole life, and the seventh never opens — so a stream per context would exhaust the
   * pool and queue every ordinary request behind it. One stream, and `keysFor` decides what each
   * event makes stale.
   *
   * Mounted here rather than in a hook a page calls, because a page-level stream would open and close
   * on every navigation — reconnecting constantly, and losing events during each gap.
   */
  useEffect(() => {
    let probing = false

    const stream = openEventStream({
      // Same-origin (ADR-0025), so the session cookie travels without `withCredentials`.
      url: '/api/v1/events',

      onEvent: (event) => {
        /*
         * Invalidate by PREFIX, and only for kinds this client knows.
         *
         * An unrecognised kind yields no keys and is ignored — deliberately, because a newer server
         * will publish kinds this build has never heard of and "refetch everything" would turn each
         * one into a thundering herd from every open tab.
         */
        for (const segment of keysFor(event.kind)) {
          void queryClient.invalidateQueries({ queryKey: [segment] })
        }
      },

      onSuspectedAuthLoss: () => {
        /*
         * `EventSource` cannot see a status code, so a 401 and a dropped socket look identical and it
         * retries both forever. The spike's row 6: an expired session becomes an endless reconnect
         * loop from every open tab with nothing on screen to say so.
         *
         * The answer is to ask the HTTP client, which already knows how to find out — one
         * authenticated request, which transparently refreshes on a 401 and calls `onSessionLost` if
         * the refresh fails. If it resolves, the session is fine and the stream is reopened; if it
         * throws, the router has already been sent to sign-in and there is nothing to reopen.
         *
         * Guarded by `probing` because the suspicion fires per failure, and a probe per retry would
         * be the request storm this is meant to avoid.
         */
        if (probing) return
        probing = true
        void ports.http
          .request('/athletes/me', { auth: {} })
          .then(() => {
            stream.reopen()
          })
          .catch(() => {
            // Session genuinely gone. `onSessionLost` has already fired.
          })
          .finally(() => {
            probing = false
          })
      },

      onGaveUp: () => {
        /*
         * Nothing on screen, and that is the considered choice.
         *
         * Live invalidation is an enhancement over refetch-on-mount, not a guarantee the product
         * makes. When the stream gives up the app degrades to exactly the behaviour it had before this
         * existed, and telling someone "live updates have stopped" invites them to act on a fact they
         * cannot do anything about.
         */
      },
    })

    return () => {
      stream.close()
    }
  }, [ports, queryClient])

  return (
    <AthletePortsProvider value={ports.athlete}>
      <GoalPortsProvider value={ports.goal}>
        <PrescriptionPortsProvider value={ports.prescription}>
          <MeasurementPortsProvider value={ports.measurement}>
            <LearningPortsProvider value={ports.learning}>
              <ReportPortsProvider value={ports.report}>
                <DashboardPortsProvider value={ports.dashboardLayout}>
                  <TimelinePortsProvider value={ports.timeline}>
                    <NutritionPortsProvider value={ports.nutrition}>
                      <WorkflowPortsProvider value={ports.workflow}>
                        <ExecutionPortsProvider value={ports.execution}>
                          {children}
                        </ExecutionPortsProvider>
                      </WorkflowPortsProvider>
                    </NutritionPortsProvider>
                  </TimelinePortsProvider>
                </DashboardPortsProvider>
              </ReportPortsProvider>
            </LearningPortsProvider>
          </MeasurementPortsProvider>
        </PrescriptionPortsProvider>
      </GoalPortsProvider>
    </AthletePortsProvider>
  )
}
