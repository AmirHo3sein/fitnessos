import { err, ok, type ProgramId, type ProgramVersionId, type Result } from '@fitnessos/kernel'
import type { ProgressionIntent } from './ProgressionIntent'
import type { ServesGoal } from './ServesGoal'

/**
 * `ProgramVersion` — an immutable programme structure.
 *
 * ADR-0008 separates two aggregates that are easy to conflate:
 *
 *   `Program`         the LINEAGE. Long-lived, mutable, owns identity and which version is
 *                     current. "Amir's strength programme."
 *   `ProgramVersion`  the STRUCTURE. Immutable from creation. "Version 3 of it."
 *
 * The split exists because a prescription that has been followed cannot be edited. A
 * `PerformedSession` records what an athlete actually did against a specific structure, and
 * if that structure could change afterwards the record becomes unreadable — you can no
 * longer tell whether they under-performed or the target moved. So a revision creates a new
 * version and leaves the old one exactly as it was.
 *
 * There are therefore **no mutators in this file.** `revise()` returns a new version; the
 * input is untouched, and a test asserts it.
 */

const brand = Symbol('ProgramVersion')

export interface Block {
  readonly id: string
  readonly name: string
  /** Zero-based position. Contiguity is an invariant — see `programVersion`. */
  readonly order: number
  /** ADR-0013: an intent, never a resolved dose. Resolution happens elsewhere. */
  readonly progressionIntent: ProgressionIntent
}

/**
 * Who decided this structure, and on what basis (ADR-0003: AI proposes, humans decide, the
 * system records why).
 *
 * `proposedBy` is separate from `decidedBy` because they differ in the case that matters: an
 * AI-proposed programme accepted by a coach was decided by the coach. Collapsing them would
 * lose the only fact that makes ADR-0003 auditable.
 */
export interface AuthoringDecision {
  readonly decidedBy: string
  readonly proposedBy: 'human' | 'assistant'
  /** Free text from the decider. Never generated, never defaulted. */
  readonly rationale: string | null
}

export interface ProgramVersion {
  readonly [brand]: true
  readonly id: ProgramVersionId
  /** The lineage this belongs to. */
  readonly programId: ProgramId
  /** Monotonic from 1. */
  readonly versionNumber: number
  readonly blocks: readonly Block[]
  /** Current purpose. NEVER an evaluation input (ADR-0008). */
  readonly servesGoal: ServesGoal | null
  readonly authoringDecision: AuthoringDecision
}

export type ProgramVersionError =
  | { readonly kind: 'no-blocks' }
  | { readonly kind: 'version-not-positive'; readonly given: number }
  | { readonly kind: 'version-not-whole'; readonly given: number }
  | { readonly kind: 'block-order-not-contiguous'; readonly orders: readonly number[] }
  | { readonly kind: 'duplicate-block-id'; readonly id: string }
  | { readonly kind: 'block-name-empty'; readonly id: string }

export interface ProgramVersionInput {
  readonly id: ProgramVersionId
  readonly programId: ProgramId
  readonly versionNumber: number
  readonly blocks: readonly Block[]
  readonly servesGoal: ServesGoal | null
  readonly authoringDecision: AuthoringDecision
}

export const programVersion = (
  input: ProgramVersionInput,
): Result<ProgramVersion, ProgramVersionError> => {
  const { versionNumber, blocks } = input

  if (!Number.isInteger(versionNumber)) {
    return err({ kind: 'version-not-whole', given: versionNumber })
  }
  if (versionNumber < 1) {
    // Version 0 is the value an uninitialised counter produces, and it would sort before
    // every real version forever.
    return err({ kind: 'version-not-positive', given: versionNumber })
  }

  if (blocks.length === 0) {
    // A programme with no blocks prescribes nothing. It is the state a half-finished
    // builder session would save, and every consumer downstream would have to special-case
    // it — so it is refused here instead.
    return err({ kind: 'no-blocks' })
  }

  const seen = new Set<string>()
  for (const block of blocks) {
    if (seen.has(block.id)) return err({ kind: 'duplicate-block-id', id: block.id })
    seen.add(block.id)
    if (block.name.trim() === '') return err({ kind: 'block-name-empty', id: block.id })
  }

  /*
   * Orders must be exactly 0..n-1, each once.
   *
   * This catches the specific bug a reorder produces: dragging a block and writing back
   * `order` for only the moved one leaves a gap or a duplicate. Neither throws — the list
   * just renders in an order nobody chose, and it renders differently depending on whether
   * the consumer sorted stably. Checking the set is cheap and the failure is otherwise
   * invisible until an athlete follows the wrong week.
   */
  const orders = blocks.map((b) => b.order)
  const distinct = new Set(orders)
  const expected = new Set(blocks.map((_, index) => index))

  // Two conditions, and the first is the one the first draft of this got wrong: comparing
  // `orders.length` to `expected.size` compares two counts that are equal by construction,
  // so `[0, 0]` sailed through. Deduplicating first is what actually detects a duplicate.
  if (distinct.size !== blocks.length || !orders.every((o) => expected.has(o))) {
    return err({ kind: 'block-order-not-contiguous', orders })
  }

  return ok({
    [brand]: true,
    id: input.id,
    programId: input.programId,
    versionNumber,
    // Sorted and frozen. Consumers get one canonical order, and `Object.freeze` makes the
    // immutability claim in the doc comment true at runtime rather than only in the types —
    // `readonly` is erased at compile time and stops nothing.
    blocks: Object.freeze([...blocks].sort((a, b) => a.order - b.order)),
    servesGoal: input.servesGoal,
    authoringDecision: input.authoringDecision,
  })
}

/**
 * Produce the next version. The input is NOT modified.
 *
 * This is the only sanctioned way to change a programme's structure, and it is a
 * constructor rather than a mutator for the reason in the file header: a structure that has
 * been followed cannot be edited without making every `PerformedSession` against it
 * unreadable.
 *
 * `authoringDecision` is required rather than carried over. A revision is a new decision by
 * a person, and inheriting the previous one would attribute this change to whoever made the
 * last one — which is precisely the audit trail ADR-0003 exists to keep.
 */
export const revise = (
  current: ProgramVersion,
  changes: {
    readonly id: ProgramVersionId
    readonly blocks: readonly Block[]
    readonly servesGoal?: ServesGoal | null
    readonly authoringDecision: AuthoringDecision
  },
): Result<ProgramVersion, ProgramVersionError> =>
  programVersion({
    id: changes.id,
    programId: current.programId,
    versionNumber: current.versionNumber + 1,
    blocks: changes.blocks,
    // `undefined` means "unchanged"; an explicit `null` means "no longer serves a goal".
    // Those are different statements, and a `??` would collapse them.
    servesGoal: changes.servesGoal === undefined ? current.servesGoal : changes.servesGoal,
    authoringDecision: changes.authoringDecision,
  })
