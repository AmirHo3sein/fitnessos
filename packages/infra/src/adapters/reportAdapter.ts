import {
  ReportConflictError,
  type Loaded,
  type ReportPorts,
  type ReportSnapshot,
} from '@fitnessos/ctx-report'
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

  /**
   * The two statuses that carry a report.
   *
   *   200  accepted, and the answer holds the NEW revision, so a coach can save twice without a
   *        re-read. Echoing back the base we sent would 409 on the second save.
   *   409  the base we quoted is no longer current (§2.1a). `allowStatus` keeps the body, because
   *        the body is the report as it now stands and discarding it would leave the author with a
   *        generic failure and no way to see what they collided with.
   */
  save: async (
    report: ReportSnapshot,
    baseRevision: number | null,
    signal?: AbortSignal,
  ): Promise<Loaded<ReportSnapshot>> => {
    const { status, body: raw } = await http.requestWithStatus(`/reports/${report.id}`, {
      method: 'PUT',
      body: reportBodyFrom(report, baseRevision),
      auth,
      allowStatus: [409],
      ...(signal ? { signal } : {}),
    })

    // Mapped before the status is inspected: a 409 body is a Report too, and a malformed one is a
    // contract violation whichever status carried it.
    const loaded = reportLoadedFrom(raw)
    if (status === 409) throw new ReportConflictError(loaded)
    return loaded
  },
})
