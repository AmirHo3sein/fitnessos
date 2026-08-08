import { err, ok, type Result } from '@fitnessos/kernel'
import { EXPERIENCE_LEVELS, type ExperienceLevel } from './vocabulary'

/**
 * Who the athlete is as a trainee. A value object with invariants; the read side uses
 * `TrainingIdentitySnapshot`, which has none (tolerant reader, strict writer).
 */

/** A real symbol so the constructor can assign it — see the note in `Availability.ts`. */
const brand = Symbol('TrainingIdentity')

export interface TrainingIdentity {
  readonly [brand]: true
  readonly experienceLevel: ExperienceLevel
  readonly trainingAgeMonths: number | null
  readonly disciplines: readonly string[]
}

export type TrainingIdentityError =
  | { readonly kind: 'unknown-experience-level'; readonly given: string }
  | { readonly kind: 'no-disciplines' }
  | { readonly kind: 'training-age-negative'; readonly given: number }
  | { readonly kind: 'training-age-not-whole'; readonly given: number }
  | {
      readonly kind: 'training-age-implausible'
      readonly given: number
      readonly maxMonths: number
    }

/**
 * Eighty years of training. Not a real limit on human achievement — a limit on what a
 * typo can silently become.
 *
 * The field is months, and people type years into it. `40` meaning forty years of
 * lifting arrives as forty months and is merely wrong; `2024` arrives as 168 years and
 * would sail through a `>= 0` check into every downstream calculation that treats
 * training age as a progression input. A bound turns that into a question at the form.
 */
export const MAX_TRAINING_AGE_MONTHS = 80 * 12

export interface TrainingIdentityInput {
  readonly experienceLevel: string
  readonly trainingAgeMonths: number | null
  readonly disciplines: readonly string[]
}

export const trainingIdentity = (
  input: TrainingIdentityInput,
): Result<TrainingIdentity, TrainingIdentityError> => {
  if (!(EXPERIENCE_LEVELS as readonly string[]).includes(input.experienceLevel)) {
    return err({ kind: 'unknown-experience-level', given: input.experienceLevel })
  }

  const disciplines = [...new Set(input.disciplines.map((d) => d.trim()).filter((d) => d !== ''))]
  if (disciplines.length === 0) {
    // An athlete trains *something*. An empty list is a form that was skipped, and a
    // programme cannot be prescribed without knowing what for.
    //
    // Note this is stricter than the contract, which permits an empty array. That is
    // the intended direction: the read side accepts an empty list from an athlete
    // recorded before this rule existed, and the write side will not create another.
    return err({ kind: 'no-disciplines' })
  }

  const age = input.trainingAgeMonths
  if (age !== null) {
    if (!Number.isInteger(age)) return err({ kind: 'training-age-not-whole', given: age })
    if (age < 0) return err({ kind: 'training-age-negative', given: age })
    if (age > MAX_TRAINING_AGE_MONTHS) {
      return err({
        kind: 'training-age-implausible',
        given: age,
        maxMonths: MAX_TRAINING_AGE_MONTHS,
      })
    }
  }

  return ok({
    [brand]: true,
    experienceLevel: input.experienceLevel as ExperienceLevel,
    trainingAgeMonths: age,
    disciplines: disciplines.sort(),
  })
}

export const trainingIdentityToInput = (value: TrainingIdentity): TrainingIdentityInput => ({
  experienceLevel: value.experienceLevel,
  trainingAgeMonths: value.trainingAgeMonths,
  disciplines: value.disciplines,
})
