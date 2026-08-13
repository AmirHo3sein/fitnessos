'use client'

import { AthletePortsProvider, useMyAthlete } from '@fitnessos/core/athlete/presentation'
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
import { keysFor, openEventStream, RESUME_IMPOSSIBLE } from '@fitnessos/infra'
import { ApiError } from '@fitnessos/infra'
import { subjectScope, type SubjectId } from '@fitnessos/kernel'
import { SubjectProvider } from '@fitnessos/ui'

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
export interface AppProvidersProps {
  readonly children: ReactNode
  /**
   * The athlete every key below is scoped to.
   *
   * Null only before onboarding, when there is no athlete yet — the onboarding route is the one
   * surface with no subject, and it reads nothing that needs one.
   */
  readonly subject: string | null
  /**
   * Flags, evaluated on the SERVER and handed down as plain booleans — the same way labels are.
   *
   * Not read in here: this is a client component, so reading `process.env` would either be
   * undefined at runtime or require `NEXT_PUBLIC_`, which inlines the value at build time and turns
   * a kill switch into a property of the build. See `composition/flags.ts`.
   */
  readonly liveInvalidation: boolean
}

export const AppProviders = ({ children, liveInvalidation, subject }: AppProvidersProps) => {
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
    /*
     * The kill switch. `live-invalidation` off means no stream is opened at all — not a stream that
     * opens and ignores events, which would still hold one of the six connections a browser allows
     * per origin and still reconnect on a schedule.
     *
     * Turning it off degrades to the behaviour that existed before the stream did: screens refresh on
     * mount and after a save. That is the property that makes this switch safe to throw at 3 a.m.
     * without shipping a build.
     */
    if (!liveInvalidation) return

    let probing = false

    const stream = openEventStream({
      // Same-origin (ADR-0025), so the session cookie travels without `withCredentials`.
      url: '/api/v1/events',

      onEvent: (event) => {
        /*
         * The server has told us we resumed from a position it no longer holds (BACKEND-CONTRACT
         * §5.3), so there is a gap and we cannot know what is in it. This is the ONE case where
         * refetching everything is right — and the reason the server is required to say so rather than
         * quietly resuming from its newest event, which would leave this client believing it was up to
         * date while a coach's revision sat unseen.
         *
         * Once per reconnect that outran the window, so the thundering-herd objection that rules this
         * out for an unrecognised kind does not apply here.
         */
        if (event.kind === RESUME_IMPOSSIBLE) {
          void queryClient.invalidateQueries()
          return
        }

        /*
         * Invalidate by PREFIX, and only for kinds this client knows.
         *
         * An unrecognised kind yields no keys and is ignored — deliberately, because a newer server
         * will publish kinds this build has never heard of and "refetch everything" would turn each
         * one into a thundering herd from every open tab.
         */
        /*
         * SUBJECT-SCOPED. The map's segments are relative — `'program'`, `'session'` — and the subject
         * prefix is applied here, because `infra` may not import a context and therefore cannot know
         * whose data a key belongs to.
         *
         * Without the prefix an event would invalidate every subject's cache at once, which is the
         * thundering herd this whole handler is written to avoid, only worse: a coach with thirty
         * athletes would refetch all thirty every time any one of them logged a session.
         */
        /*
         * The frame's OWN subject decides whose cache to drop, falling back to this surface's subject
         * when a frame does not say (§5.6, and an older server).
         *
         * Using this surface's subject unconditionally would be wrong the moment a coach is watching
         * more than one athlete: every event from any of them would invalidate the one currently on
         * screen — refetching the wrong athlete and leaving the right one stale, which is the same
         * silent wrongness the subject-scoped keys were introduced to prevent.
         */
        const target = event.subject ?? subject
        if (target === null) return
        for (const segment of keysFor(event.kind)) {
          void queryClient.invalidateQueries({
            queryKey: [...subjectScope(target as SubjectId), segment],
          })
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
  }, [liveInvalidation, ports, queryClient, subject])

  /*
   * The subject wraps the port tree rather than sitting inside it, because it is the same kind of
   * fact: ADR-0031 has ports provided by the route group that uses them, and the subject arrives from
   * exactly the same place. The coach route group will supply the id from its URL; this one supplies
   * the signed-in athlete's own.
   *
   * Onboarding is the single surface with no subject — the athlete does not exist until it completes.
   * It reads nothing subject-scoped, so the tree renders without a provider, and `createDiContext`
   * throws if anything below it reads one. A loud failure is what we want here: the alternative is a
   * silent read of somebody else's id, which is the whole class of bug this change exists to close.
   */
  const tree = (
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
                          <SubjectGate seed={subject}>{children}</SubjectGate>
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

  return tree
}

/**
 * Supplies the subject, resolved on the CLIENT.
 *
 * ## Why not from the server-rendered prop alone
 *
 * That was the first attempt and it broke 43 e2e tests with
 * `Subject ports were read outside their provider`. The layout's RSC prefetch of `myAthleteQuery` can
 * fail — a cold stub, a slow dependency, anything — and before the subject existed that was harmless:
 * `prefetchQuery` does not throw, the client fetched normally, and the only cost was a loading flash.
 * Once the provider depended on it, the same failure meant no provider ever mounted and every page
 * below threw during render.
 *
 * So the server value is a SEED, not the source. The client's own athlete query is authoritative,
 * which is also the honest arrangement: the athlete surface's subject IS the signed-in athlete, and
 * the client is what knows that.
 *
 * ## Why an unresolved subject renders nothing rather than its children
 *
 * `useSubject()` throws when read outside a provider, deliberately — a surface that forgets one must
 * fail loudly rather than silently read somebody else's id. That guard only works if we never render
 * subject-reading children while the answer is still unknown.
 *
 * `null` after the query settles means there is no athlete: onboarding has not run. That surface reads
 * nothing subject-scoped, so it renders without a provider — and if anything below it ever does read
 * one, it will say so.
 */
const SubjectGate = ({
  seed,
  children,
}: {
  readonly seed: string | null
  readonly children: ReactNode
}) => {
  const me = useMyAthlete()
  const subject = me.data?.id ?? seed

  if (subject !== null) {
    return <SubjectProvider value={subject as SubjectId}>{children}</SubjectProvider>
  }

  /*
   * No subject. `getMine` THROWS rather than returning null, so both reasons arrive as errors and the
   * status is the only thing that separates them — which is what the first fix got wrong.
   *
   *   404  no athlete: onboarding has not run. That surface reads nothing subject-scoped, so it
   *        renders without a provider, and anything below it that does read one will say so.
   *   401  the session is gone. The client's `onSessionLost` is already replacing the route with
   *        sign-in; rendering children in the meantime would throw first and pre-empt it.
   *   else pending, or a transient failure the client will retry.
   *
   * Rendering nothing costs a frame. Rendering children costs the throw that broke 43 e2e tests.
   */
  const missing = me.error instanceof ApiError && me.error.status === 404
  if (missing) return <>{children}</>

  return null
}
