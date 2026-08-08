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

export interface PrescriptionPorts {
  readonly prescription: PrescriptionReadPort
}
