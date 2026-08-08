/**
 * @fitnessos/infra — adapters. Framework-free, platform-aware.
 *
 * Implements the ports declared by application layers. Nothing in presentation
 * may import this package (`no-presentation-to-infra`) — the DI container is
 * assembled in apps/web/composition and arrives as a prop (handbook §2.2, B1).
 *
 * Contract types are confined to `mappers/` and never re-exported from here.
 */

export { createHttpClient, ApiError, NetworkError } from './http/client'
export { ContractViolationError, type ContractIssue } from './http/errors'
export type {
  HttpClient,
  HttpConfig,
  RequestOptions,
  AuthContext,
  HttpMode,
} from './http/client'
export { createRefresher } from './http/refresh'
export type { Refresher, RefreshConfig } from './http/refresh'

export { createAthleteReadAdapter } from './adapters/athleteReadAdapter'
export { createAuthAdapter } from './adapters/authAdapter'
export { createAthleteWriteAdapter } from './adapters/athleteWriteAdapter'

// Only the mapping FUNCTION is exported, never a type. The types it produces are
// declared by the application layer and re-exported from there; a type family
// exported from infra would become a second source of truth and drift from the
// first without anything detecting it.
export { athleteFrom, onboardingBodyFrom } from './mappers/athlete'
export { codeRequestedFrom, sessionEstablishedFrom } from './mappers/auth'
export { parseContract } from './mappers/parse'
