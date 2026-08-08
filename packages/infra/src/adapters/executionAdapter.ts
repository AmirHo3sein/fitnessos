import type { ExecutionReadPort, PrescribedSessionSnapshot } from '@fitnessos/core/execution'
import type { AuthContext, HttpClient } from '../http/client'
import { sessionsFrom } from '../mappers/session'

export const createExecutionAdapter = (
  http: HttpClient,
  auth: AuthContext,
): ExecutionReadPort => ({
  upcomingSessions: async (
    signal?: AbortSignal,
  ): Promise<readonly PrescribedSessionSnapshot[]> => {
    const raw = await http.request('/sessions/upcoming', {
      auth,
      ...(signal ? { signal } : {}),
    })
    return sessionsFrom(raw)
  },
})
