import type { CheckInFormSnapshot, Loaded } from './ports/index'

/**
 * Someone else saved this check-in form while it was open here.
 *
 * Carries it as the server now holds it, because a conflict the author cannot see is a conflict
 * they cannot resolve (ADR-0033, ADR-0035). Both sides survive: the local document is still in the
 * editor, and `current` is what it collided with.
 *
 * The ENVELOPE rather than the form alone. The 409 body carries the revision that refused the
 * save, and that revision is what any later "keep mine" would have to send as its base — dropping
 * it here would leave resolution with nothing to write against. It stops at this layer all the
 * same: the hook hands the editor `.artefact` only, so the revision never reaches the undo stack
 * (ADR-0035).
 *
 * Lives beside the ports rather than in a use case, because saving a form has none — the hook
 * calls the write port directly, and this is part of that port's contract (BACKEND-CONTRACT
 * §2.1a).
 */
export class CheckInFormConflictError extends Error {
  override readonly name = 'CheckInFormConflictError'
  constructor(readonly current: Loaded<CheckInFormSnapshot>) {
    super('the check-in form was saved elsewhere')
  }
}
