import type { DashboardPorts, DashboardSnapshot } from '@fitnessos/ctx-dashboard'
import type { AuthContext, HttpClient } from '../http/client'
import { dashboardBodyFrom, dashboardFrom } from '../mappers/dashboard'

/** HTTP implementation of the Dashboard ports. */
export const createDashboardAdapter = (
  http: HttpClient,
  auth: AuthContext,
): DashboardPorts['dashboard'] => ({
  current: async (signal?: AbortSignal): Promise<DashboardSnapshot | null> => {
    const raw = await http.request('/dashboards/current', { auth, ...(signal ? { signal } : {}) })
    // 204 → null. "No dashboard yet" is the normal first-run state, not an error.
    if (raw === undefined || raw === null) return null
    return dashboardFrom(raw)
  },

  save: async (dashboard, signal?: AbortSignal): Promise<DashboardSnapshot> =>
    dashboardFrom(
      await http.request(`/dashboards/${dashboard.id}`, {
        method: 'PUT',
        body: dashboardBodyFrom(dashboard),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
