import type { DashboardSnapshot } from '../../editor/schema'

/**
 * An artefact as the server holds it: the document, and the revision to send back when saving it.
 *
 * The revision is deliberately OUTSIDE the snapshot. The snapshot is the editor's document, so a
 * revision inside it would be undoable — undo would restore a stale precondition and the next save
 * would answer 409 for a reason the author cannot see (ADR-0035).
 *
 * Declared locally rather than shared: the artefact contexts must not import each other, and two
 * fields are cheaper to repeat than a cross-context dependency.
 */
export interface Loaded<T> {
  readonly artefact: T
  /**
   * `null` only when the server sent none — a server older than BACKEND-CONTRACT §2.1a. It is
   * nullable rather than a number so that case has somewhere to land: the alternative is inventing
   * a base the client never read, which satisfies the precondition against someone else's work and
   * is precisely the overwrite §2.1a exists to prevent.
   */
  readonly revision: number | null
}

/** Dashboard — ports. One read, one write; a dashboard owns a layout and nothing to query. */
export interface DashboardReadPort {
  readonly current: (signal?: AbortSignal) => Promise<Loaded<DashboardSnapshot> | null>
}

export interface DashboardWritePort {
  /**
   * A replace, not a revision: nothing references a widget. Same reasoning as a report.
   *
   * `baseRevision` is the revision last read, and `null` means "I believe nothing is here" — correct
   * only for a first save. Sending it wrong is refused with 409 rather than silently overwriting
   * whoever wrote in between (BACKEND-CONTRACT §2.1a).
   */
  readonly save: (
    dashboard: DashboardSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ) => Promise<Loaded<DashboardSnapshot>>
}

export interface DashboardPorts {
  readonly dashboard: DashboardReadPort & DashboardWritePort
}

/**
 * Someone else saved this dashboard while it was open here.
 *
 * Carries it as the server now holds it, because a conflict the author cannot see is a conflict they
 * cannot resolve (ADR-0033, ADR-0035). Both sides survive: the local document is still in the editor,
 * and `current` is what it collided with.
 *
 * A `Loaded`, not a bare snapshot: the revision arrives with the read it belongs to, and the one the
 * refused save carried is now stale by definition. Dropping it here would leave the only correct base
 * for a resolving write nowhere to be found.
 *
 * Declared beside the port because the port's 409 is the only thing that raises it — the adapter
 * implementing `save` throws it, and nothing else may.
 */
export class DashboardConflictError extends Error {
  override readonly name = 'DashboardConflictError'
  constructor(readonly current: Loaded<DashboardSnapshot>) {
    super('the dashboard was saved elsewhere')
  }
}
