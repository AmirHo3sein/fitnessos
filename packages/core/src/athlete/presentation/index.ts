/**
 * Athlete — presentation. The only React-aware code in this context.
 *
 * May not import `@fitnessos/infra` (`no-presentation-to-infra`). Ports arrive
 * through `AthletePortsProvider`, mounted by `apps/web/composition`.
 */

export { AthletePortsProvider, useAthletePorts } from './di'
export { useMyAthlete } from './hooks/useMyAthlete'
export {
  useCompleteOnboarding,
  type UseCompleteOnboarding,
} from './hooks/useCompleteOnboarding'
export {
  OnboardingForm,
  type OnboardingFormProps,
  type OnboardingLabels,
} from './views/OnboardingForm'
export {
  AthleteSummary,
  type AthleteSummaryLabels,
  type AthleteSummaryProps,
} from './views/AthleteSummary'
