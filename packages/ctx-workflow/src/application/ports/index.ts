import type { WorkflowSnapshot } from '../../editor/schema'

/** Workflow — ports. One workflow per coach for now; nothing else to query. */
export interface WorkflowReadPort {
  readonly current: (signal?: AbortSignal) => Promise<WorkflowSnapshot | null>
}

export interface WorkflowWritePort {
  /**
   * A replace, like every other authored artefact.
   *
   * Worth one caveat the others do not need: a workflow can be ENABLED, so replacing one changes
   * what the backend will do on the next matching event. The contract says the server must reject a
   * body whose graph is not runnable while `enabled` is true — see BACKEND-CONTRACT — because a
   * client bug must not be able to switch on something that cannot run.
   */
  readonly save: (workflow: WorkflowSnapshot, signal?: AbortSignal) => Promise<WorkflowSnapshot>
}

export interface WorkflowPorts {
  readonly workflow: WorkflowReadPort & WorkflowWritePort
}
