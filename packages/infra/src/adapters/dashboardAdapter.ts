import type { DashboardPorts, DashboardSnapshot, Loaded } from '@fitnessos/ctx-dashboard'
import type { AuthContext, HttpClient } from '../http/client'
import { dashboardBodyFrom, dashboardLoadedFrom } from '../mappers/dashboard'

/** HTTP implementation of the Dashboard ports. */
export const createDashboardAdapter = (
  http: HttpClient,
  auth: AuthContext,
): DashboardPorts['dashboard'] => ({
  current: async (signal?: AbortSignal): Promise<Loaded<DashboardSnapshot> | null> => {
    const raw = await http.request('/dashboards/current', { auth, ...(signal ? { signal } : {}) })
    // 204 → null. "No dashboard yet" is the normal first-run state, not an error.
    if (raw === undefined || raw === null) return null
    // The revision comes back BESIDE the document, never inside it: the snapshot is the editor's
    // undoable state and a write precondition must not be undoable (ADR-0035).
    return dashboardLoadedFrom(raw)
  },

  save: async (
    dashboard,
    baseRevision,
    signal?: AbortSignal,
  ): Promise<Loaded<DashboardSnapshot>> =>
    // The accepted write returns the NEXT revision, so a second save needs no re-read (§2.1a).
    dashboardLoadedFrom(
      await http.request(`/dashboards/${dashboard.id}`, {
        method: 'PUT',
        body: dashboardBodyFrom(dashboard, baseRevision),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
