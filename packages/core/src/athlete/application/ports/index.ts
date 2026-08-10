import type { AthleteId, PersonId, Quantity } from '@fitnessos/kernel'
import type { AvailabilityInput } from '../../domain/Availability'
import type { TrainingIdentityInput } from '../../domain/TrainingIdentity'

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
 * Re-exported from the domain, where they are declared. The application layer is a
 * consumer of the vocabulary, not its owner — a domain value object reaching into the
 * application layer for the name of one of its own states would have the layering
 * backwards, and `no-domain-to-app` says so.
 */
import type { AthleteStatus, ExperienceLevel } from '../../domain/vocabulary'

export type { AthleteStatus, ExperienceLevel }

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

/**
 * The write side.
 *
 * Returns the updated `AthleteSnapshot` rather than void, and that is a deliberate
 * contract choice rather than a convenience. A void mutation forces the client to
 * either refetch (an extra round trip on the slowest connection in the flow) or guess
 * the new state (which is how a cache and a database diverge). Returning the
 * server's own view means the cache can be *set* rather than invalidated.
 */
export interface AthleteWritePort {
  readonly completeOnboarding: (
    input: {
      readonly trainingIdentity: TrainingIdentityInput
      readonly availability: AvailabilityInput
    },
    signal?: AbortSignal,
  ) => Promise<AthleteSnapshot>
}

export interface AthletePorts {
  readonly athlete: AthleteReadPort & AthleteWritePort
}
