import type { AthleteId, GoalId, ProgramId, ProgramVersionId } from '@fitnessos/kernel'
import type { ProgressionKind } from '../../domain/ProgressionIntent'

/**
 * Prescription — ports.
 *
 * Read models (D-06), so no invariants: tolerant reader. The aggregates in `domain/` enforce
 * the rules when a programme is authored; these accept whatever the backend holds, including
 * programmes written before a rule existed.
 *
 * `ProgramSnapshot` carries its current version inline. That looks like merging two
 * aggregates, and it is not — it is a read PROJECTION (ADR-0011, S2: project presentation).
 * A client rendering a programme always needs both, and two round trips to show one screen
 * is a cost paid on the slowest connection in the product.
 */

export interface BlockSnapshot {
  readonly id: string
  readonly name: string
  readonly order: number
  readonly progression: { readonly kind: ProgressionKind; readonly ratePercent: number | null }
}

export interface ProgramVersionSnapshot {
  readonly id: ProgramVersionId
  readonly programId: ProgramId
  readonly versionNumber: number
  readonly blocks: readonly BlockSnapshot[]
  /** Current purpose. Never an evaluation input (ADR-0008). */
  readonly servesGoal: { readonly goalId: GoalId; readonly rationale: string | null } | null
  readonly authoredBy: { readonly decidedBy: string; readonly proposedBy: 'human' | 'assistant' }
}

export interface ProgramSnapshot {
  readonly id: ProgramId
  readonly athleteId: AthleteId
  readonly title: string
  readonly currentVersion: ProgramVersionSnapshot
}

export interface PrescriptionReadPort {
  /**
   * The athlete's current programme, or null when they have none.
   *
   * Null rather than a thrown 404: having no programme yet is the normal state for a
   * newly-onboarded athlete, not an error. Throwing would put an error boundary in the path
   * of the most common first-run experience.
   */
  readonly currentProgram: (signal?: AbortSignal) => Promise<ProgramSnapshot | null>
}

/**
 * A revision, as the client submits it.
 *
 * `id` is generated here rather than by the server, and `baseVersionId` says what was edited
 * FROM. Together they make the request both replayable and collision-aware — see the contract
 * notes on `ReviseProgramBody`.
 *
 * `versionNumber` is deliberately absent: it belongs to the lineage, and a client that guessed
 * it would race whoever else has the same programme open.
 */
export interface ReviseProgramInput {
  readonly programId: ProgramId
  readonly id: ProgramVersionId
  readonly baseVersionId: ProgramVersionId
  readonly blocks: readonly BlockSnapshot[]
  readonly servesGoal: { readonly goalId: GoalId; readonly rationale: string | null } | null
  readonly authoredBy: { readonly decidedBy: string; readonly proposedBy: 'human' | 'assistant' }
}

export interface PrescriptionWritePort {
  /**
   * Create the next version.
   *
   * Resolves with the programme as the server now holds it — the response IS the new state, so
   * the caller can set the cache rather than invalidate and refetch.
   *
   * Rejects with `ProgramConflictError` when `baseVersionId` is no longer current. That is a
   * distinct outcome from a failure: nothing went wrong, someone else got there first, and the
   * author needs to see both.
   */
  readonly revise: (input: ReviseProgramInput, signal?: AbortSignal) => Promise<ProgramSnapshot>
}

export interface PrescriptionPorts {
  readonly prescription: PrescriptionReadPort & PrescriptionWritePort
}
