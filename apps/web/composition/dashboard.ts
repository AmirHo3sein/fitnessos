import type { DashboardPorts } from '@fitnessos/ctx-dashboard'
import { createDashboardAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Dashboard-layout ports. Imported by the `(app)` route group only. */
export const createDashboardPorts = (http: HttpClient, auth: AuthContext): DashboardPorts => ({
  dashboard: createDashboardAdapter(http, auth),
})
