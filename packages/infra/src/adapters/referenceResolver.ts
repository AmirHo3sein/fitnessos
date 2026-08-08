import type { GoalReadPort } from '@fitnessos/core/goal'
import type {
  DocumentRef,
  ReferenceResolver,
  RefResolution,
} from '@fitnessos/editor-engine'
import { ApiError } from '../http/errors'

/**
 * Resolves cross-document references (handbook D-08).
 *
 * This is the anticorruption layer the port exists to create. Prescription holds a reference to a
 * goal and must not import Development to find out what it is called — that is exactly the
 * coupling a context boundary prevents. So the editor asks "resolve these", and the composition
 * root supplies something that knows how. Only this file sees both sides.
 *
 * ## Why a resolver never rejects for a missing target
 *
 * A deleted goal is not an error, it is a state the document is expected to be in. An editor that
 * failed to open because a goal was tidied up last week would have lost a coach's programme to
 * someone else's cleanup. So a target that cannot be found becomes `{ state: 'broken' }` and the
 * editor renders it. Genuine failures — the network is down, the server is broken — still reject,
 * because those are temporary and retrying is the right response.
 */

export interface ResolverDeps {
  readonly goal: GoalReadPort
  /**
   * Builds the link for a resolved reference.
   *
   * Injected rather than hard-coded, because a URL is the app's business and this package must
   * not know the route table. `apps/web` owns `/goals/:id`; a future admin app would own its own.
   */
  readonly hrefFor: (kind: DocumentRef['kind'], id: string) => string
}

/**
 * `forbidden`, not `deleted`, when the API says so.
 *
 * The two are different facts about the world and the chip tells them apart. A 403 on a goal
 * belonging to another coach's athlete means it exists and is not yours to see (ADR-0002 /
 * ADR-0014); reporting that as "deleted" would tell a coach something untrue about a goal that
 * is still there.
 */
const brokenFrom = (error: unknown): RefResolution => {
  if (error instanceof ApiError && error.status === 403) {
    return { state: 'broken', reason: 'forbidden' }
  }
  return { state: 'broken', reason: 'deleted' }
}

export const createReferenceResolver = (deps: ResolverDeps): ReferenceResolver => ({
  resolve: async (refs, signal) => {
    const out = new Map<string, RefResolution>()
    if (refs.length === 0) return out

    const goalRefs = refs.filter((ref) => ref.kind === 'goal')

    if (goalRefs.length > 0) {
      /*
       * One list call, not one per reference. `listMine` returns the athlete's goals and every
       * reference in a programme points at one of them, so the whole batch resolves from a single
       * response — which is the reason `resolve` takes an array at all.
       *
       * A goal absent from the list is broken. That is a slightly coarse read (it could be
       * archived rather than deleted), and it is the honest one available from this endpoint:
       * what the client can actually say is "it is not among your goals".
       */
      try {
        const goals = await deps.goal.listMine(signal)
        const byId = new Map(goals.map((goal) => [String(goal.id), goal]))

        for (const ref of goalRefs) {
          const goal = byId.get(ref.id)
          out.set(
            `${ref.kind}:${ref.id}`,
            goal === undefined
              ? { state: 'broken', reason: 'deleted' }
              : {
                  state: 'resolved',
                  // The athlete's own words, verbatim — the same string the goal view shows.
                  label: goal.intent,
                  href: deps.hrefFor('goal', ref.id),
                },
          )
        }
      } catch (error) {
        // An aborted request is a navigation, not a broken reference. Marking every goal broken
        // because the user changed page would flash warnings across the editor on the way out.
        if (signal?.aborted) throw error
        // A 403 on the list means this reader may not see the athlete's goals at all, so every
        // goal reference is forbidden rather than deleted.
        const resolution = brokenFrom(error)
        for (const ref of goalRefs) out.set(`${ref.kind}:${ref.id}`, resolution)
      }
    }

    /*
     * Kinds with no resolver yet are reported BROKEN rather than left out of the map.
     *
     * Omitting them would leave the chip loading forever, which reads as a hung editor. Broken
     * with the fallback label is honest and renders something the coach can act on. When
     * `indicator` and `movement` acquire read ports, they get their own branch above and this
     * stops applying to them.
     */
    for (const ref of refs) {
      if (!out.has(`${ref.kind}:${ref.id}`)) {
        out.set(`${ref.kind}:${ref.id}`, { state: 'broken', reason: 'deleted' })
      }
    }

    return out
  },
})
