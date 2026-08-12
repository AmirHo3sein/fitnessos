import type {
  Loaded,
  WorkflowEdge,
  WorkflowNode,
  WorkflowSnapshot,
} from '@fitnessos/ctx-workflow'
import { WorkflowSchema, type components } from '@fitnessos/contracts'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Workflow mappers.
 *
 * The one authored artefact with NO sorting on the way in, and that absence is the finding rather
 * than an oversight: a graph has no order. Nodes are identified by id and sequenced by edges, so
 * sorting them would impose a meaning the document does not have — and a client that sorted by, say,
 * `x` would silently reorder the step list every time a coach dragged a node.
 *
 * Execution order, where it is needed, comes from `executionOrder` in the context's own topology.
 */
type ContractWorkflow = components['schemas']['Workflow']
type ValidatedWorkflow = z.infer<typeof WorkflowSchema>

const snapshotFrom = (c: ValidatedWorkflow): WorkflowSnapshot => ({
  id: c.id,
  title: c.title,
  enabled: c.enabled,
  nodes: c.nodes.map(
    (n): WorkflowNode => ({ id: n.id, kind: n.kind, detail: n.detail, x: n.x, y: n.y }),
  ),
  edges: c.edges.map((e): WorkflowEdge => ({ id: e.id, from: e.from, port: e.port, to: e.to })),
})

export const workflowFrom = (raw: unknown): WorkflowSnapshot =>
  snapshotFrom(parseContract(WorkflowSchema, raw, 'Workflow'))

/**
 * The same read, plus the revision the next save must quote (BACKEND-CONTRACT §2.1a).
 *
 * A sibling rather than a field on `WorkflowSnapshot`, because that snapshot is the editor's
 * document: a revision inside it would be undone along with the graph, and the save after an undo
 * would answer 409 with nothing on screen to explain it (ADR-0035).
 *
 * Absent `revision` becomes null rather than a number. An older server sends none, and inventing
 * one would have this client assert a base it never read — the silent overwrite §2.1a exists to
 * stop, arriving through the very code meant to prevent it.
 */
export const loadedWorkflowFrom = (raw: unknown): Loaded<WorkflowSnapshot> => {
  const c = parseContract(WorkflowSchema, raw, 'Workflow')
  return { artefact: snapshotFrom(c), revision: c.revision ?? null }
}

export const workflowBodyFrom = (
  workflow: WorkflowSnapshot,
  /** Null on a first save only; see `WorkflowWritePort.save`. Omitted from the body when null. */
  baseRevision: number | null = null,
): ValidatedWorkflow => {
  const body = {
    ...(baseRevision === null ? {} : { baseRevision }),
    id: workflow.id,
    title: workflow.title,
    enabled: workflow.enabled,
    nodes: workflow.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      detail: n.detail,
      x: n.x,
      y: n.y,
    })),
    edges: workflow.edges.map((e) => ({ id: e.id, from: e.from, port: e.port, to: e.to })),
  }
  return parseContract(WorkflowSchema, body, 'Workflow (request)')
}

export const WORKFLOW_COVERAGE: Record<keyof ContractWorkflow, true> = {
  id: true,
  title: true,
  nodes: true,
  edges: true,
  enabled: true,
  // Both are handled, and neither reaches the snapshot: `revision` comes back in the envelope and
  // `baseRevision` goes out on the request. They are preconditions on a write, not content.
  revision: true,
  baseRevision: true,
}

const _agrees: FieldsAgree<ContractWorkflow, ValidatedWorkflow> = true
void _agrees
