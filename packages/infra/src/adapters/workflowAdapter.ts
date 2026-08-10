import type { WorkflowPorts, WorkflowSnapshot } from '@fitnessos/ctx-workflow'
import type { AuthContext, HttpClient } from '../http/client'
import { workflowBodyFrom, workflowFrom } from '../mappers/workflow'

/** HTTP implementation of the Workflow ports. */
export const createWorkflowAdapter = (
  http: HttpClient,
  auth: AuthContext,
): WorkflowPorts['workflow'] => ({
  current: async (signal?: AbortSignal): Promise<WorkflowSnapshot | null> => {
    const raw = await http.request('/workflows/current', {
      auth,
      ...(signal ? { signal } : {}),
    })
    // 204 → null: no automation is the normal state, and most coaches will never author one.
    if (raw === undefined || raw === null) return null
    return workflowFrom(raw)
  },

  save: async (workflow, signal?: AbortSignal): Promise<WorkflowSnapshot> =>
    workflowFrom(
      await http.request(`/workflows/${workflow.id}`, {
        method: 'PUT',
        body: workflowBodyFrom(workflow),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
