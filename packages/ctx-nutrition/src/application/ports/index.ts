import type { NutritionSnapshot } from '../../editor/schema'

/**
 * An artefact as the server holds it: the document, and the revision to send back when saving it.
 *
 * The revision is deliberately OUTSIDE the snapshot. The snapshot is the editor's document, and a
 * revision inside it would be undoable — undo would restore a stale precondition, and the next save
 * would answer 409 for a reason the author can neither see nor act on (ADR-0035).
 *
 * Declared here rather than shared: the contexts must not import one another, and two fields
 * repeated is cheaper than a dependency between boundaries.
 *
 * `null` is a server older than §2.1a, which sent no revision at all. It is carried as "no base"
 * rather than defaulted, because a guessed precondition is one that passes — and a save that passes
 * on a guess is exactly the silent overwrite the precondition exists to prevent.
 */
export interface Loaded<T> {
  readonly artefact: T
  readonly revision: number | null
}

/** Nutrition — ports. A plan owns its meals; there is nothing else to query. */
export interface NutritionReadPort {
  readonly current: (signal?: AbortSignal) => Promise<Loaded<NutritionSnapshot> | null>
}

export interface NutritionWritePort {
  /**
   * A replace: nothing references a meal or an item. Same reasoning as every other artefact.
   *
   * `baseRevision` is the revision last read. `null` claims nothing is stored yet, which is true
   * only of a first save; against a plan that already exists the server answers 409 with what it
   * holds (§2.1a), so a coach cannot overwrite an athlete's edit they never read.
   */
  readonly save: (
    plan: NutritionSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ) => Promise<Loaded<NutritionSnapshot>>
}

export interface NutritionPorts {
  readonly nutrition: NutritionReadPort & NutritionWritePort
}
