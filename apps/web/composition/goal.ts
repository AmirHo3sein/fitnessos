import type { GoalPorts } from '@fitnessos/core/goal'
import { createGoalAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/**
 * Goal ports. Imported by the `(app)` route group only — see the note in `container.ts`
 * on why there is no single factory that builds every context's ports.
 */
export const createGoalPorts = (http: HttpClient, auth: AuthContext): GoalPorts => ({
  goal: createGoalAdapter(http, auth),
})
