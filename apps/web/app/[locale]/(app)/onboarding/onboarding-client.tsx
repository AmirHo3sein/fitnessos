'use client'

import { OnboardingForm, type OnboardingLabels } from '@fitnessos/core/athlete/presentation'
import { GoalDeclarationForm, type GoalLabels } from '@fitnessos/core/goal/presentation'
import type { AthleteId } from '@fitnessos/kernel'
import { useState } from 'react'
import { useRouter } from '../../../../src/i18n/navigation'

/**
 * Onboarding, in two steps: who the athlete is, then what they want.
 *
 * The order is not arbitrary. The goal step needs an `AthleteId`, and the athlete record
 * is what produces one — so the identity step has to complete first. Asking for the goal
 * up front would mean either holding it client-side across a request that might fail, or
 * inventing an id before the server has assigned one.
 *
 * Modelled as a discriminated union rather than a step counter plus nullable fields. A
 * `step: 2` with `athleteId: AthleteId | null` admits the state "on the goal step with no
 * athlete", which is unreachable by design and would have to be handled anyway. This
 * cannot represent it.
 */
type Stage =
  | { readonly name: 'athlete' }
  | { readonly name: 'goal'; readonly athleteId: AthleteId }

export const OnboardingClient = ({
  athleteLabels,
  goalLabels,
  disciplineOptions,
}: {
  athleteLabels: OnboardingLabels
  goalLabels: GoalLabels
  disciplineOptions: readonly string[]
}) => {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>({ name: 'athlete' })

  // `replace`, not `push`: onboarding is complete, so the back button must not return the
  // athlete to a form that would re-submit what they just recorded.
  const finish = () => {
    router.replace('/dashboard')
  }

  if (stage.name === 'athlete') {
    return (
      <OnboardingForm
        labels={athleteLabels}
        disciplineOptions={disciplineOptions}
        onComplete={(athlete) => {
          setStage({ name: 'goal', athleteId: athlete.id })
        }}
      />
    )
  }

  return (
    <GoalDeclarationForm
      athleteId={stage.athleteId}
      labels={goalLabels}
      onDeclared={finish}
      // Skipping is a first-class outcome, not a shortcut. A goal declared to get past a
      // form becomes the thing every future prescription and evaluation is judged
      // against — worse than arriving without one.
      onSkip={finish}
    />
  )
}
