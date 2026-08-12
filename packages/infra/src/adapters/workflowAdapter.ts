import type { Loaded, WorkflowPorts, WorkflowSnapshot } from '@fitnessos/ctx-workflow'
import type { AuthContext, HttpClient } from '../http/client'
import { loadedWorkflowFrom, workflowBodyFrom } from '../mappers/workflow'

/** HTTP implementation of the Workflow ports. */
export const createWorkflowAdapter = (
  http: HttpClient,
  auth: AuthContext,
): WorkflowPorts['workflow'] => ({
  current: async (signal?: AbortSignal): Promise<Loaded<WorkflowSnapshot> | null> => {
    const raw = await http.request('/workflows/current', {
      auth,
      ...(signal ? { signal } : {}),
    })
    // 204 → null: no automation is the normal state, and most coaches will never author one.
    if (raw === undefined || raw === null) return null
    return loadedWorkflowFrom(raw)
  },

  /*
    The revision travels both ways: out as `baseRevision`, back as the `revision` of what was
    stored. Reading the new one out of the response is what lets an author save twice without a
    refetch in between (BACKEND-CONTRACT §2.1a) — and dropping it would leave the second save
    quoting a base the server has already superseded.
  */
  save: async (
    workflow,
    baseRevision,
    signal?: AbortSignal,
  ): Promise<Loaded<WorkflowSnapshot>> =>
    loadedWorkflowFrom(
      await http.request(`/workflows/${workflow.id}`, {
        method: 'PUT',
        body: workflowBodyFrom(workflow, baseRevision),
        auth,
        ...(signal ? { signal } : {}),
      }),
    ),
})
