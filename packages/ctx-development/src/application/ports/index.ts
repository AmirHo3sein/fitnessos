/**
 * Development — ports.
 *
 * Interfaces only. Implementations live in `packages/infra` and are injected via
 * the container assembled in apps/web/composition (handbook §2.2, B1).
 *
 * ADR-0027 §6.1 note: the backend uses dynamic dispatch for the same reason this
 * layer uses interfaces — providers are selected by configuration at runtime.
 *
 * Never call Date.now() in a use case. Take a Clock and pass a fixed one in tests.
 */

import type { Clock } from '@fitnessos/kernel'

export interface DevelopmentPorts {
  readonly clock: Clock
}
