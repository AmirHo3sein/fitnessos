import type { WorkflowSnapshot } from '../../editor/schema'

/**
 * An artefact as the server holds it: the document, and the revision to send back when saving it.
 *
 * The revision is deliberately OUTSIDE the snapshot. `WorkflowSnapshot` IS the editor's document —
 * it hydrates into a draft and every one of its fields is declared in `HYDRATE_COVERAGE` — so a
 * revision inside it would be part of the undoable state, and an undo would restore a stale
 * precondition. The next save would then answer 409 for a reason the author can neither see nor act
 * on (ADR-0035). A revision is a precondition on a write, not content of the artefact.
 *
 * Declared here rather than imported from a shared package: contexts do not import each other, and
 * two fields are cheaper duplicated than shared across a boundary that exists on purpose.
 */
export interface Loaded<T> {
  readonly artefact: T
  /**
   * Null only when the server sent none — a build predating BACKEND-CONTRACT §2.1a. It travels back
   * as an absent `baseRevision` and the server decides. Defaulting it to a number would claim a base
   * this client never read, which is the silent overwrite the precondition exists to prevent.
   */
  readonly revision: number | null
}

/** Workflow — ports. One workflow per coach for now; nothing else to query. */
export interface WorkflowReadPort {
  readonly current: (signal?: AbortSignal) => Promise<Loaded<WorkflowSnapshot> | null>
}

export interface WorkflowWritePort {
  /**
   * A replace, like every other authored artefact.
   *
   * Worth one caveat the others do not need: a workflow can be ENABLED, so replacing one changes
   * what the backend will do on the next matching event. The contract says the server must reject a
   * body whose graph is not runnable while `enabled` is true — see BACKEND-CONTRACT — because a
   * client bug must not be able to switch on something that cannot run.
   *
   * `baseRevision` is the revision the author last read (§2.1a). `null` means "I believe nothing is
   * here", which is only true of a first save; sending it against a workflow that already exists is
   * itself a collision and answers 409 — an author replacing something they never read.
   *
   * A collision rejects with `WorkflowConflictError`, which carries the server's copy; every other
   * failure rejects with whatever the transport raised.
   */
  readonly save: (
    workflow: WorkflowSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ) => Promise<Loaded<WorkflowSnapshot>>
}

/**
 * Someone else saved this workflow while it was open here.
 *
 * Carries it as the server now holds it, because a conflict the author cannot see is a conflict they
 * cannot resolve (ADR-0033, ADR-0035). Both sides survive: the local document is still in the editor,
 * and `current` is what it collided with.
 *
 * Declared beside the port that throws it rather than in a use case, because the package has none —
 * `save` is a straight write, and the 409 is part of its contract (BACKEND-CONTRACT §2.1a), not a
 * rule some later use case might add.
 *
 * `current` keeps its envelope: whoever resolves the collision has to save again, and that save must
 * quote the revision it collided with. Unwrapping it here would discard the one field that makes the
 * conflict resolvable.
 */
export class WorkflowConflictError extends Error {
  override readonly name = 'WorkflowConflictError'
  constructor(readonly current: Loaded<WorkflowSnapshot>) {
    super('the workflow was saved elsewhere')
  }
}

export interface WorkflowPorts {
  readonly workflow: WorkflowReadPort & WorkflowWritePort
}
