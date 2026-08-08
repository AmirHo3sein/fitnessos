import type {
  AthleteSnapshot,
  AthleteStatus,
  AvailabilitySnapshot,
  ExperienceLevel,
  TrainingIdentitySnapshot,
} from '@fitnessos/core/athlete'
import {
  AthleteSchema,
  CompleteOnboardingBodySchema,
  type components,
} from '@fitnessos/contracts'
import { idFrom, isOk, type Quantity, seconds } from '@fitnessos/kernel'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Athlete mappers — the anticorruption layer.
 *
 * This is the ONLY module permitted to import `@fitnessos/contracts`
 * (`no-contracts-escape`). It is also the most-skipped discipline in this
 * architecture: the moment a contract type appears in presentation, a backend
 * field rename becomes a UI change and the layer is decorative.
 *
 * The target types are declared by the APPLICATION layer (`@fitnessos/core`), not
 * here. An earlier draft of this file declared its own `AthleteView` family and
 * aliased the enums straight off the contract (`ContractAthlete['status']`). Both
 * were mistakes, and they were the same mistake twice:
 *
 *   - a parallel type family drifts from the one the application actually uses,
 *     and nothing detects the drift;
 *   - an enum aliased off the contract means a backend enum change flows
 *     silently into the application type and out into every `switch`. The alias
 *     looks like insulation while transmitting the change perfectly.
 *
 * Declaring the union in the application layer inverts that: a backend enum
 * change breaks compilation *here*, at the boundary, which is the one place
 * someone can decide what the new value means in our language.
 *
 * Handbook §5 defines three tiers:
 *
 *   tier 1  branded alias   shapes identical, type inert          ~1 line
 *   tier 2  field mapper    names differ, or a Quantity is needed  ~10 lines
 *   tier 3  full mapper     target has behaviour and invariants    ~40 lines
 *
 * Athlete is tier 2.
 */

type ContractAthlete = components['schemas']['Athlete']
type ContractTrainingIdentity = components['schemas']['TrainingIdentity']
type ContractAvailability = components['schemas']['Availability']

/**
 * The shapes as the VALIDATOR sees them, which is what the mapping functions below
 * actually receive.
 *
 * Distinct from the `Contract*` types above only in optional-property treatment:
 * `z.number().optional()` infers `number | undefined`, while openapi-typescript emits
 * `number` on an optional key, and under `exactOptionalPropertyTypes` those are not
 * mutually assignable. The difference cannot be observed for JSON input — JSON has no
 * `undefined`, so a key is either absent or holds a real value.
 *
 * Typing the helpers against these rather than casting is the honest option: they
 * consume validated data, so they should say so. The `Contract*` types remain the
 * source for the enum maps and the coverage assertions, where they are the thing
 * being checked against.
 */
type Validated = z.infer<typeof AthleteSchema>
type ValidatedTrainingIdentity = Validated['trainingIdentity']
type ValidatedAvailability = Validated['availability']

/**
 * Exhaustive wire→domain vocabulary maps.
 *
 * `Record<ContractX, DomainY>` in both directions of failure: add a value to the
 * contract enum and this map stops compiling; remove one from the domain enum and
 * the value type stops compiling. Today the two vocabularies happen to coincide,
 * so every entry is an identity — but writing it as a map rather than a cast is
 * what makes the *next* divergence a compile error instead of a runtime surprise.
 */
const STATUS: Record<ContractAthlete['status'], AthleteStatus> = {
  active: 'active',
  dormant: 'dormant',
  archived: 'archived',
}

const EXPERIENCE: Record<ContractTrainingIdentity['experienceLevel'], ExperienceLevel> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
}

const trainingIdentityFrom = (c: ValidatedTrainingIdentity): TrainingIdentitySnapshot => ({
  experienceLevel: EXPERIENCE[c.experienceLevel],
  trainingAgeMonths: c.trainingAgeMonths ?? null,
  disciplines: c.disciplines,
})

const sessionCeilingFrom = (raw: number | undefined): Quantity<'duration'> | null => {
  if (raw === undefined) return null
  const q = seconds(raw)
  // `unwrapOr` cannot express this: its fallback must have the same type as the
  // success value, so widening to `| null` previously needed
  // `null as unknown as Quantity<'duration'>` — an assertion that made a null
  // claim to be a Quantity and would have surfaced as a crash on the first
  // malformed payload rather than as a missing value. isOk narrows honestly.
  return isOk(q) ? q.value : null
}

const availabilityFrom = (c: ValidatedAvailability): AvailabilitySnapshot => ({
  daysPerWeek: c.daysPerWeek,
  // The contract carries `sessionCeilingSeconds: number`; the application carries
  // a Quantity. That conversion is exactly what N11 exists to force — a bare
  // number is how a duration silently becomes minutes three layers downstream.
  sessionCeiling: sessionCeilingFrom(c.sessionCeilingSeconds),
  equipmentAccess: c.equipmentAccess,
})

/**
 * Takes `unknown`, not `ContractAthlete`.
 *
 * That signature is the point. A typed parameter would let a caller hand over an
 * unvalidated `as ContractAthlete` cast and skip the check entirely — which is what
 * the adapter did before this existed. With `unknown` there is no typed value to pass
 * in, so validation cannot be bypassed by accident.
 *
 * The validated result is what gets mapped, not the raw input: Zod strips unknown
 * keys, so what comes out of `parseContract` is exactly the published contract and
 * nothing else.
 */
export const athleteFrom = (raw: unknown): AthleteSnapshot => {
  const c = parseContract(AthleteSchema, raw, 'Athlete')
  return {
    id: idFrom<'AthleteId'>(c.id),
    personId: idFrom<'PersonId'>(c.personId),
    status: STATUS[c.status],
    trainingIdentity: trainingIdentityFrom(c.trainingIdentity),
    availability: availabilityFrom(c.availability),
  }
}

/**
 * Completeness assertion (D-09).
 *
 * If the backend adds a field to Athlete, this map stops compiling and the build
 * fails at exactly one line — instead of the field being silently dropped and
 * discovered as missing data a year later.
 */
export const ATHLETE_COVERAGE: Record<keyof ContractAthlete, true> = {
  id: true,
  personId: true,
  status: true,
  trainingIdentity: true,
  availability: true,
}

/**
 * The type and the validator are generated from the same spec in the same run, so
 * they should never describe different fields. This is what makes that checkable
 * rather than assumed — if the two generators ever disagree, the type promises one
 * shape while the validator enforces another, and every guarantee in this layer is
 * quietly void.
 *
 * The error surfaces here, at one line, naming the field that diverged.
 */
const _athleteFieldsAgree: FieldsAgree<ContractAthlete, Validated> = true
const _identityFieldsAgree: FieldsAgree<ContractTrainingIdentity, ValidatedTrainingIdentity> = true
const _availabilityFieldsAgree: FieldsAgree<ContractAvailability, ValidatedAvailability> = true
void _athleteFieldsAgree
void _identityFieldsAgree
void _availabilityFieldsAgree

// --- outbound: domain → wire ------------------------------------------------
//
// The first mapping in this direction, and it validates too (ADR-0031 named request
// bodies as a follow-up). Validating what we SEND catches a mapper bug at the boundary
// rather than as a 400 from the server, where the diagnostic is a status code and a
// message written for an operator.
//
// The resource name carries the direction, so a telemetry entry reads
// "CompleteOnboardingBody (request)" rather than being indistinguishable from a bad
// response. A violation here is our defect; a violation on a response is the server's.

type ContractOnboardingBody = components['schemas']['CompleteOnboardingBody']

/**
 * The body as the VALIDATOR types it. Same optional-property divergence as the read
 * side: `z.number().optional()` infers `number | undefined`, openapi-typescript emits
 * `number` on an optional key, and under `exactOptionalPropertyTypes` those are not
 * mutually assignable. Unobservable for JSON, since JSON has no `undefined`.
 *
 * Returning the validated type rather than the openapi one keeps this honest — the
 * function returns what it actually produced. The openapi type stays as the thing being
 * checked against, below.
 */
type ValidatedOnboardingBody = z.infer<typeof CompleteOnboardingBodySchema>

export interface OnboardingRequest {
  readonly trainingIdentity: {
    readonly experienceLevel: string
    readonly trainingAgeMonths: number | null
    readonly disciplines: readonly string[]
  }
  readonly availability: {
    readonly daysPerWeek: number
    readonly sessionCeilingSeconds: number | null
    readonly equipmentAccess: readonly string[]
  }
}

export const onboardingBodyFrom = (input: OnboardingRequest): ValidatedOnboardingBody => {
  const body = {
    trainingIdentity: {
      experienceLevel: input.trainingIdentity.experienceLevel,
      // `null` becomes an ABSENT key, not `null` on the wire. The contract marks this
      // optional rather than nullable, and JSON has no undefined — so sending
      // `trainingAgeMonths: null` would fail schema validation on a field the athlete
      // simply left blank.
      ...(input.trainingIdentity.trainingAgeMonths === null
        ? {}
        : { trainingAgeMonths: input.trainingIdentity.trainingAgeMonths }),
      disciplines: [...input.trainingIdentity.disciplines],
    },
    availability: {
      daysPerWeek: input.availability.daysPerWeek,
      ...(input.availability.sessionCeilingSeconds === null
        ? {}
        : { sessionCeilingSeconds: input.availability.sessionCeilingSeconds }),
      equipmentAccess: [...input.availability.equipmentAccess],
    },
  }

  return parseContract(CompleteOnboardingBodySchema, body, 'CompleteOnboardingBody (request)')
}

export const ONBOARDING_BODY_COVERAGE: Record<keyof ContractOnboardingBody, true> = {
  trainingIdentity: true,
  availability: true,
}

const _onboardingFieldsAgree: FieldsAgree<ContractOnboardingBody, ValidatedOnboardingBody> = true
void _onboardingFieldsAgree
