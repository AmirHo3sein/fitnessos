import type { ExecutionPorts } from '@fitnessos/core/execution'
import { createExecutionAdapter } from '@fitnessos/infra'
import type { AuthContext, HttpClient } from './container'

/** Execution ports. Imported by the `(app)` route group only. */
export const createExecutionPorts = (http: HttpClient, auth: AuthContext): ExecutionPorts => ({
  execution: createExecutionAdapter(http, auth),
})
