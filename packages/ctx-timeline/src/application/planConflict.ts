import type { PlanSnapshot } from '../editor/schema'
import type { Loaded } from './ports/index'

/**
 * Someone else saved this plan while it was open here.
 *
 * Carries it as the server now holds it, because a conflict the author cannot see is a conflict
 * they cannot resolve (ADR-0033, ADR-0035). Both sides survive: the local document is still in the
 * editor, and `current` is what it collided with.
 *
 * ## Why `Loaded`, and not the snapshot alone
 *
 * The revision travels with it. Resolving a collision ends in a save, and a save asserts the
 * revision it replaces (§2.1a) — hand the author the colliding plan without its revision and the
 * only base they can assert is the stale one that just lost, so every attempt to keep their work
 * answers 409 again. Visible, and still unresolvable, which is the failure this class exists to
 * prevent.
 */
export class PlanConflictError extends Error {
  override readonly name = 'PlanConflictError'
  constructor(readonly current: Loaded<PlanSnapshot>) {
    super('the plan was saved elsewhere')
  }
}
