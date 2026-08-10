import type { WorkflowPorts } from '@fitnessos/ctx-workflow'
import { createWorkflowAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Workflow ports. Imported by the `(app)` route group only. */
export const createWorkflowPorts = (http: HttpClient, auth: AuthContext): WorkflowPorts => ({
  workflow: createWorkflowAdapter(http, auth),
})
