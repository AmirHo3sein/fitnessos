import type { Loaded, ReportPorts, ReportSnapshot } from '@fitnessos/ctx-report'
import type { AuthContext, HttpClient } from '../http/client'
import { reportBodyFrom, reportLoadedFrom } from '../mappers/report'

/** HTTP implementation of the Report ports. */
export const createReportAdapter = (
  http: HttpClient,
  auth: AuthContext,
): ReportPorts['report'] => ({
  current: async (signal?: AbortSignal): Promise<Loaded<ReportSnapshot> | null> => {
    const raw = await http.request('/reports/current', { auth, ...(signal ? { signal } : {}) })
    // 204 → null. "No report yet" is the normal state, and `undefined` reaching a component is
    // how that becomes a blank screen with no explanation.
    if (raw === undefined || raw === null) return null
    // Document and revision come out of ONE response and travel together from here. Reading the
    // revision by any other route would quote a precondition for a document nobody read.
    return reportLoadedFrom(raw)
  },

  save: async (
    report: ReportSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ): Promise<Loaded<ReportSnapshot>> =>
    // The accepted write answers with the NEW revision, so a coach can save twice without a
    // re-read. Echoing back the base we sent would 409 on the second save.
    reportLoadedFrom(
      await http.request(`/reports/${report.id}`, {
        method: 'PUT',
        body: reportBodyFrom(report, baseRevision),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
