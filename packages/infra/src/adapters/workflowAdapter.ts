import {
  WorkflowConflictError,
  type Loaded,
  type WorkflowPorts,
  type WorkflowSnapshot,
} from '@fitnessos/ctx-workflow'
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

    The two statuses:

      200  stored. The body is the workflow as saved, carrying its new revision.
      409  the base was not current. `allowStatus` keeps the BODY, which §2.1a defines as the
           workflow as it now stands — throw it away and the author is told only that the save
           failed, which is a collision they can see but not resolve.
  */
  save: async (workflow, baseRevision, signal?: AbortSignal): Promise<Loaded<WorkflowSnapshot>> => {
    const { status, body: raw } = await http.requestWithStatus(`/workflows/${workflow.id}`, {
      method: 'PUT',
      body: workflowBodyFrom(workflow, baseRevision),
      auth,
      allowStatus: [409],
      ...(signal ? { signal } : {}),
    })

    // Mapped before the status is inspected: a 409 body is a Workflow too, and a malformed one is a
    // contract violation whichever status carried it.
    const loaded = loadedWorkflowFrom(raw)
    if (status === 409) throw new WorkflowConflictError(loaded)
    return loaded
  },
})
