/**
 * Athlete — presentation. The only React-aware code in this context.
 *
 * May not import `@fitnessos/infra` (`no-presentation-to-infra`). Ports arrive
 * through `AthletePortsProvider`, mounted by `apps/web/composition`.
 */

export { AthletePortsProvider, useAthletePorts } from './di'
export { useMyAthlete } from './hooks/useMyAthlete'
export {
  AthleteSummary,
  type AthleteSummaryLabels,
  type AthleteSummaryProps,
} from './views/AthleteSummary'
