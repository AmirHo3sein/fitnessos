import type { PlanSnapshot } from '../../editor/schema'

/**
 * An artefact as the server holds it: the document, and the revision to send back when saving it.
 *
 * The revision is deliberately OUTSIDE the snapshot. `PlanSnapshot` is the editor's document — it
 * is hydrated into a draft and every one of its fields is declared in `HYDRATE_COVERAGE`, so a
 * `revision` there would be either undoable (undo restores a stale precondition, and the next save
 * answers 409 for a reason the author cannot see) or carried around by an editor that must never
 * read it. It is a precondition on a write, not content of the plan (ADR-0035).
 *
 * Declared here rather than imported from a shared package: the seven artefact contexts must not
 * import one another, and two fields are cheaper to repeat than a cross-context edge is to keep.
 *
 * `revision` is nullable because an older server sends none, and the honest answer is then "I have
 * no base to assert" rather than a fabricated one — a made-up base that happened to match would
 * overwrite a write this client never saw.
 */
export interface Loaded<T> {
  readonly artefact: T
  readonly revision: number | null
}

/** Timeline — ports. One read, one write: a plan owns its phases and there is nothing to query. */
export interface TimelineReadPort {
  readonly current: (signal?: AbortSignal) => Promise<Loaded<PlanSnapshot> | null>
}

export interface TimelineWritePort {
  /**
   * A replace: nothing references a phase. Same reasoning as the form, report and dashboard.
   *
   * `baseRevision` is the revision last read, and `null` means "I believe nothing is here" —
   * correct only for a first save. Against an existing plan the server answers 409, carrying the
   * plan as it now stands, rather than letting this write erase one it was not written against.
   */
  readonly save: (
    plan: PlanSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ) => Promise<Loaded<PlanSnapshot>>
}

export interface TimelinePorts {
  readonly timeline: TimelineReadPort & TimelineWritePort
}
