import type { ReportReadPort, ReportSnapshot, ReportWritePort } from '@fitnessos/ctx-report'
import type { AuthContext, HttpClient } from '../http/client'
import { reportBodyFrom, reportFrom } from '../mappers/report'

/** HTTP implementation of the Report ports. */
export const createReportAdapter = (
  http: HttpClient,
  auth: AuthContext,
): ReportReadPort & ReportWritePort => ({
  current: async (signal?: AbortSignal): Promise<ReportSnapshot | null> => {
    const raw = await http.request('/reports/current', { auth, ...(signal ? { signal } : {}) })
    // 204 → null. "No report yet" is the normal state, and `undefined` reaching a component is
    // how that becomes a blank screen with no explanation.
    if (raw === undefined || raw === null) return null
    return reportFrom(raw)
  },

  save: async (report, signal?: AbortSignal): Promise<ReportSnapshot> => {
    const body = reportBodyFrom(report)
    return reportFrom(
      await http.request(`/reports/${report.id}`, {
        method: 'PUT',
        body,
        auth,
        ...(signal ? { signal } : {}),
      }),
    )
  },
})
