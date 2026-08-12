import type { ReportSnapshot } from '../../editor/schema'

/**
 * Report — ports.
 *
 * One read, one write, and no query beyond "the current one". A report owns a layout; there is
 * nothing here to filter, aggregate or derive, and a richer port would be inventing a use case
 * the product does not have.
 */

/**
 * An artefact as the server holds it: the document, and the revision to send back when saving it.
 *
 * The revision is deliberately OUTSIDE the snapshot. `ReportSnapshot` is the editor's document —
 * it is hydrated into a draft and every one of its fields is undoable or preserved — so a revision
 * inside it would be restored by an undo, and the next save would answer 409 for a reason the
 * author can neither see nor act on (ADR-0035 addendum). A precondition on a write is not content
 * of the artefact.
 *
 * Declared locally rather than shared: artefact contexts must not import each other, and two
 * fields are cheaper to repeat than a cross-context dependency.
 *
 * `revision` is nullable because an older server omits it. Null means "no precondition I can
 * assert"; the alternative is fabricating one, and a fabricated base that happens to match
 * silently overwrites whoever wrote in between — the exact loss §2.1a exists to prevent.
 */
export interface Loaded<T> {
  readonly artefact: T
  readonly revision: number | null
}

export interface ReportReadPort {
  /** The current report, or null when a coach has not made one. */
  readonly current: (signal?: AbortSignal) => Promise<Loaded<ReportSnapshot> | null>
}

export interface ReportWritePort {
  /**
   * Create or replace it.
   *
   * A replace, not a revision: nothing references a tile, so replacing a report cannot make
   * anything else unreadable. That is why this needs no client-generated id — the same reasoning
   * as a check-in form, and the opposite of a programme version.
   *
   * `baseRevision` is the revision last read, and `null` means "I believe nothing is here" —
   * correct only for a first save. Against a report that already exists it is refused with 409
   * rather than silently overwriting the other author (BACKEND-CONTRACT §2.1a).
   */
  readonly save: (
    report: ReportSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ) => Promise<Loaded<ReportSnapshot>>
}

export interface ReportPorts {
  readonly report: ReportReadPort & ReportWritePort
}
