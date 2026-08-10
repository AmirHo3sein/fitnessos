import type { WorkflowEdge, WorkflowNode, WorkflowSnapshot } from '@fitnessos/ctx-workflow'
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

export const workflowFrom = (raw: unknown): WorkflowSnapshot => {
  const c = parseContract(WorkflowSchema, raw, 'Workflow')
  return {
    id: c.id,
    title: c.title,
    enabled: c.enabled,
    nodes: c.nodes.map(
      (n): WorkflowNode => ({ id: n.id, kind: n.kind, detail: n.detail, x: n.x, y: n.y }),
    ),
    edges: c.edges.map(
      (e): WorkflowEdge => ({ id: e.id, from: e.from, port: e.port, to: e.to }),
    ),
  }
}

export const workflowBodyFrom = (workflow: WorkflowSnapshot): ValidatedWorkflow => {
  const body = {
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
}

const _agrees: FieldsAgree<ContractWorkflow, ValidatedWorkflow> = true
void _agrees
