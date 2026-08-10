import type { TimelinePorts } from '@fitnessos/ctx-timeline'
import { createTimelineAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Timeline ports. Imported by the `(app)` route group only. */
export const createTimelinePorts = (http: HttpClient, auth: AuthContext): TimelinePorts => ({
  timeline: createTimelineAdapter(http, auth),
})
