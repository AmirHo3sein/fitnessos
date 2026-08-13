import {
  DashboardConflictError,
  type DashboardPorts,
  type DashboardSnapshot,
  type Loaded,
} from '@fitnessos/ctx-dashboard'
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

  /**
   * The two statuses that carry a dashboard (BACKEND-CONTRACT §2.1a):
   *
   *   200  saved. The body is the NEXT revision, so a second save needs no re-read.
   *   409  `baseRevision` is no longer current — someone else saved in between. `allowStatus` keeps
   *        the body, because the body is the dashboard as it now stands; `request` would turn the
   *        status into an `ApiError` and discard it, leaving the author with "we could not store
   *        your change" and no way to see what they collided with.
   */
  save: async (
    dashboard,
    baseRevision,
    signal?: AbortSignal,
  ): Promise<Loaded<DashboardSnapshot>> => {
    const { status, body: raw } = await http.requestWithStatus(`/dashboards/${dashboard.id}`, {
      method: 'PUT',
      body: dashboardBodyFrom(dashboard, baseRevision),
      auth,
      allowStatus: [409],
      ...(signal ? { signal } : {}),
    })

    // Mapped before the status is inspected: a 409 body is a Dashboard too, and a malformed one is a
    // contract violation whichever status carried it.
    const loaded = dashboardLoadedFrom(raw)
    if (status === 409) throw new DashboardConflictError(loaded)
    return loaded
  },
})
