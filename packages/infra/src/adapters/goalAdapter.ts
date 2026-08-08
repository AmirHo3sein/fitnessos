import type { GoalReadPort, GoalSnapshot, GoalWritePort } from '@fitnessos/core/goal'
import type { AuthContext, HttpClient } from '../http/client'
import { declareGoalBodyFrom, goalFrom, goalsFrom } from '../mappers/goal'

/**
 * HTTP implementation of the Goal ports.
 *
 * `POST`, not `PUT`: declaring a goal creates a new one each time, and two goals with the
 * same wording are legitimately different goals declared at different moments. Unlike
 * onboarding, this is not idempotent and must not pretend to be.
 */
export const createGoalAdapter = (
  http: HttpClient,
  auth: AuthContext,
): GoalReadPort & GoalWritePort => ({
  listMine: async (signal?: AbortSignal): Promise<readonly GoalSnapshot[]> => {
    const raw = await http.request('/goals', { auth, ...(signal ? { signal } : {}) })
    return goalsFrom(raw)
  },

  declare: async (input, signal): Promise<GoalSnapshot> => {
    const raw = await http.request('/goals', {
      method: 'POST',
      body: declareGoalBodyFrom(input),
      auth,
      ...(signal ? { signal } : {}),
    })
    return goalFrom(raw)
  },
})
