/**
 * The Athlete context's closed vocabularies.
 *
 * These live in `domain/`, not `application/`. They were briefly in the application
 * layer, which `no-domain-to-app` correctly rejects — dependencies point inward, and a
 * domain value object that had to reach into the application layer for the name of one
 * of its own states would have the layering backwards.
 *
 * Declared here rather than aliased off the generated contract. An alias
 * (`ContractAthlete['status']`) looks like insulation while transmitting a backend enum
 * change perfectly, into every `switch` in the codebase. A declared union breaks
 * compilation in `infra/mappers`, which is the one place someone can decide what a new
 * value means in our language.
 */

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced'

/** `dormant` is the athlete's own pause, not an administrative one — see ADR-0008. */
export type AthleteStatus = 'active' | 'dormant' | 'archived'

export const EXPERIENCE_LEVELS: readonly ExperienceLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
]
