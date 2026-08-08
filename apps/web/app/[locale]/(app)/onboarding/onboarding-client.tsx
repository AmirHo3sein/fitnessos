'use client'

import { OnboardingForm, type OnboardingLabels } from '@fitnessos/core/athlete/presentation'
import { useRouter } from '../../../../src/i18n/navigation'

/**
 * The client leaf for onboarding.
 *
 * No provider mounted here: `(app)/layout.tsx` already mounts `AppProviders`, and
 * onboarding lives inside that group. Mounting a second one would build a second
 * container, and the cache write in `useCompleteOnboarding` would then land in a
 * different QueryClient to the one the dashboard reads.
 */
export const OnboardingClient = ({
  labels,
  disciplineOptions,
}: {
  labels: OnboardingLabels
  disciplineOptions: readonly string[]
}) => {
  const router = useRouter()

  return (
    <OnboardingForm
      labels={labels}
      disciplineOptions={disciplineOptions}
      onComplete={() => {
        // `replace`, not `push`: onboarding is complete, so the back button must not
        // return the athlete to a form that would re-submit what they just recorded.
        router.replace('/dashboard')
      }}
    />
  )
}
