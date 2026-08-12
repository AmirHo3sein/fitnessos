import type { AthleteId } from '../ids/index'

/**
 * Whose data a query is about.
 *
 * ## Why every query key starts with this
 *
 * Until a coach existed, `['program']` was unambiguous: one client could see exactly one programme, so
 * the key needed no subject. The moment a viewer can switch between athletes that same key becomes a
 * **cache collision** — TanStack Query would serve athlete A's programme for a `['program']` read made
 * while looking at athlete B, with no error, no contract violation and nothing in telemetry.
 *
 * It renders one athlete's training under another athlete's name. That is the worst class of defect
 * this product can have, and it is invisible.
 *
 * So the subject is not appended, it is the PREFIX: `['subject', <id>, 'program', …]`. Prefix-first
 * means `invalidateQueries({ queryKey: subjectScope(id) })` drops exactly one athlete's cache and
 * nothing else, which is what the event-driven invalidation already relies on.
 */
export type SubjectId = AthleteId

/** The prefix every subject-scoped key begins with. */
/**
 * `'subject'` and not `'athlete'`: `athleteKeys.all` is already `['athlete']`, so an `['athlete', id]`
 * prefix would make invalidating the athlete profile drop every subject's entire cache. Two meanings
 * for one root is exactly the ambiguity this change exists to remove.
 */
export const subjectScope = (subject: SubjectId) => ['subject', subject] as const

/**
 * Keys that are deliberately NOT subject-scoped, with the reason.
 *
 * There are exactly two, and the list exists so that adding a second is a decision somebody makes on
 * purpose rather than a shortcut nobody notices. `apps/web/composition/invalidation.test.ts` asserts
 * this list has not grown.
 *
 * - **`me`** — "who is the authenticated person's athlete" (ADR-0005). Asked BEFORE any subject
 *   exists, and answered by the response that supplies one. Subject-scoping it would require the
 *   answer in order to ask the question.
 * - **`sync-issues`** — the offline queue is DEVICE-local. It holds what this phone failed to send,
 *   which is a property of the device rather than of any athlete: only an athlete logs their own
 *   sessions (a coach never does), so there is no second subject whose queue could be confused with
 *   it. Scoping it would imply a coach could have one.
 */
export const UNSCOPED_KEY_ROOTS = ['me', 'sync-issues'] as const
