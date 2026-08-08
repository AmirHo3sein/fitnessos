import type { AthleteId, GoalId, PlainDate } from '@fitnessos/kernel'

/**
 * Goal — ports.
 *
 * `GoalSnapshot` is a read model (D-06) and has no invariants, unlike the `Goal`
 * aggregate. Tolerant reader, strict writer: this accepts whatever the backend holds,
 * including goals recorded before a rule existed.
 *
 * It carries no derived state — no `isOverdue`, no `status` (ADR-0006). Those are
 * computed by the domain functions from the snapshot plus a date, at the moment they
 * are asked. A snapshot with an `isOverdue` field would be a stored derivation smuggled
 * across the wire, and would be wrong by the time it arrived.
 */
export interface GoalSnapshot {
  readonly id: GoalId
  readonly athleteId: AthleteId
  /** The athlete's own words, verbatim. */
  readonly intent: string
  readonly declaredOn: PlainDate
  readonly horizon: PlainDate | null
  readonly cadenceDays: number
}

export interface GoalWritePort {
  readonly declare: (
    input: {
      readonly intent: string
      readonly horizon: PlainDate | null
      readonly cadenceDays: number
    },
    signal?: AbortSignal,
  ) => Promise<GoalSnapshot>
}

export interface GoalReadPort {
  /** The athlete's active goals. Ordering and filtering are the server's business. */
  readonly listMine: (signal?: AbortSignal) => Promise<readonly GoalSnapshot[]>
}

export interface GoalPorts {
  readonly goal: GoalReadPort & GoalWritePort
}
