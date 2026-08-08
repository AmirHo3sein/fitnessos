import { isErr } from '@fitnessos/kernel'
import {
  availability,
  availabilityToInput,
  type AvailabilityError,
  type AvailabilityInput,
} from '../domain/Availability'
import {
  trainingIdentity,
  trainingIdentityToInput,
  type TrainingIdentityError,
  type TrainingIdentityInput,
} from '../domain/TrainingIdentity'
import type { AthletePorts, AthleteSnapshot } from './ports/index'

/**
 * Complete onboarding: record who the athlete is and what they can commit to.
 *
 * The use case, not the hook, is where the rules are applied. The hook composes
 * (D-05); this constructs both value objects, and only sends if both are valid.
 *
 * **Both, before either.** An earlier shape validated and sent each section as the
 * user finished it, which is worse than it looks: a valid training identity followed by
 * an invalid availability leaves the athlete half-recorded, and the next screen has to
 * cope with a state the domain says cannot exist. Constructing both first means the
 * request is all-or-nothing, and `PUT` makes resubmitting it safe.
 */

export type OnboardingError =
  | { readonly section: 'trainingIdentity'; readonly reason: TrainingIdentityError }
  | { readonly section: 'availability'; readonly reason: AvailabilityError }

/**
 * Thrown, not returned. These cross into TanStack Query, where a rejected promise is
 * how a mutation reports failure (handbook §2.2) — Result stays inside the domain.
 *
 * Carries the section as well as the reason so the form can put the message on the
 * field that caused it. An error that says only "invalid" makes the user hunt.
 */
export class OnboardingValidationError extends Error {
  override readonly name = 'OnboardingValidationError'
  constructor(readonly problem: OnboardingError) {
    super(`${problem.section}: ${problem.reason.kind}`)
  }
}

export interface OnboardingDraft {
  readonly trainingIdentity: TrainingIdentityInput
  readonly availability: AvailabilityInput
}

export const completeOnboarding = async (
  ports: AthletePorts,
  draft: OnboardingDraft,
  signal?: AbortSignal,
): Promise<AthleteSnapshot> => {
  const identity = trainingIdentity(draft.trainingIdentity)
  if (isErr(identity)) {
    throw new OnboardingValidationError({ section: 'trainingIdentity', reason: identity.error })
  }

  const avail = availability(draft.availability)
  if (isErr(avail)) {
    throw new OnboardingValidationError({ section: 'availability', reason: avail.error })
  }

  // The value objects are converted back to wire inputs rather than the raw draft being
  // forwarded. That is the point of constructing them: what gets sent is the normalised
  // form — deduplicated, sorted, trimmed — not whatever the form happened to hold. Send
  // the draft and two athletes who chose the same equipment in a different order write
  // different rows.
  return ports.athlete.completeOnboarding(
    {
      trainingIdentity: trainingIdentityToInput(identity.value),
      availability: availabilityToInput(avail.value),
    },
    signal,
  )
}
