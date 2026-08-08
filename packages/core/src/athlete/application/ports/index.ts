import type { AthleteId, PersonId, Quantity } from '@fitnessos/kernel'

/**
 * Athlete — ports.
 *
 * Interfaces only. The implementation lives in `packages/infra` and is injected
 * via the container assembled in apps/web/composition (handbook §2.2, B1).
 *
 * Note what these types are NOT: they are not contract types. `AthleteSnapshot`
 * below is declared here, in the application layer, and `infra/mappers` is
 * responsible for producing it. That direction matters — if the port returned a
 * contract type, `no-contracts-escape` would be satisfied on paper while every
 * consumer of the port depended on the backend's field names in practice.
 */

/**
 * These unions are the ubiquitous language, declared here rather than aliased off
 * the contract on purpose. Aliasing would mean a backend enum change flowed
 * silently into every `switch` in the codebase; declaring it means the change
 * breaks compilation in `infra/mappers`, which is the one place someone can
 * decide what the new value means in our language.
 */
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'

/** `dormant` is the athlete's own pause, not an administrative one — see ADR-0008. */
export type AthleteStatus = 'active' | 'dormant' | 'archived'

export interface TrainingIdentitySnapshot {
  readonly experienceLevel: ExperienceLevel
  readonly trainingAgeMonths: number | null
  readonly disciplines: readonly string[]
}

export interface AvailabilitySnapshot {
  readonly daysPerWeek: number
  /** Null when the athlete has stated no ceiling — not zero. */
  readonly sessionCeiling: Quantity<'duration'> | null
  readonly equipmentAccess: readonly string[]
}

export interface AthleteSnapshot {
  readonly id: AthleteId
  readonly personId: PersonId
  readonly status: AthleteStatus
  readonly trainingIdentity: TrainingIdentitySnapshot
  readonly availability: AvailabilitySnapshot
}

export interface AthleteReadPort {
  /**
   * The athlete owned by the authenticated person.
   *
   * Rejects rather than returning null on failure: the boundary throws so that
   * TanStack Query and React error boundaries work with the grain
   * (kernel/result, handbook §2.2). Result stays inside the domain.
   */
  readonly getMine: (signal?: AbortSignal) => Promise<AthleteSnapshot>
}

export interface AthletePorts {
  readonly athlete: AthleteReadPort
}
