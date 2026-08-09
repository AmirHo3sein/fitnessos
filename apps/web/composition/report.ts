import type { ReportPorts } from '@fitnessos/ctx-report'
import { createReportAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Report ports. Imported by the `(app)` route group only. */
export const createReportPorts = (http: HttpClient, auth: AuthContext): ReportPorts => ({
  report: createReportAdapter(http, auth),
})
