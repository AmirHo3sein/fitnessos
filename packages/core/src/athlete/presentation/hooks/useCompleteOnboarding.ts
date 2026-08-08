'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  athleteKeys,
  completeOnboarding,
  type AthleteSnapshot,
  type OnboardingDraft,
} from '../../application/index'
import { useAthletePorts } from '../di'

export interface UseCompleteOnboarding {
  readonly submit: (draft: OnboardingDraft) => void
  readonly isSubmitting: boolean
  readonly error: Error | null
  readonly reset: () => void
}

/**
 * Records onboarding and updates the cache.
 *
 * The cache handling is the part worth reading. `setQueryData`, not
 * `invalidateQueries` — the mutation already returns the server's own view of the
 * athlete, so invalidating would throw that away and immediately refetch what we are
 * holding. That is an extra round trip at the end of a form, on the slowest connection
 * in the flow, to obtain data already in hand.
 *
 * Invalidation is still the right tool when a mutation's effects are wider than its
 * response — that is what `athleteInvalidations` exists for, keyed by domain event.
 * Here the response IS the new state, so setting is both cheaper and has no window in
 * which the cache and the server disagree.
 *
 * Under the 40-line cap (D-05): the rules live in `completeOnboarding`, where they can
 * be tested without a renderer. This composes.
 */
export const useCompleteOnboarding = (
  onComplete: (athlete: AthleteSnapshot) => void,
): UseCompleteOnboarding => {
  const ports = useAthletePorts()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (draft: OnboardingDraft) => completeOnboarding(ports, draft),
    onSuccess: (athlete) => {
      queryClient.setQueryData(athleteKeys.mine(), athlete)
      // Wrapped rather than passed as `onSuccess` directly: TanStack calls it with
      // `(data, variables, context)`, which would hand the caller the submitted draft
      // and the QueryClient alongside the athlete.
      onComplete(athlete)
    },
  })

  return {
    submit: mutation.mutate,
    isSubmitting: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  }
}
