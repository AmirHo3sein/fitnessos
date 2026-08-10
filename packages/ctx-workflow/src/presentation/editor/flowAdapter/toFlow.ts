import type { DocumentSnapshot } from '@fitnessos/editor-engine'
import type { Edge, Node as FlowNode } from '@xyflow/react'
import type { OutputPort, WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../../domain/Workflow'
import { EDGE_NODE, isEdge, isStep } from '../../../editor/schema'

/**
 * `DocumentSnapshot` → what React Flow renders (handbook D-11).
 *
 * One direction of the adapter, and the direction that makes the document the source of truth.
 * React Flow is given nodes and edges derived from the document on every render; its own internal
 * store is a rendering detail we never read back except through `fromFlow`.
 *
 * ## The one place React Flow's state is allowed to lead
 *
 * Node position during a drag. React Flow translates the node itself, at frame rate, and we hear
 * about it once on `onNodeDragStop`. Dispatching per frame would put a history entry — and an
 * immer produce over the whole document — behind every mouse move. That is D-11's "controlled
 * document, uncontrolled drag", and the cost of it is that between pointerdown and pointerup the
 * rendered position and the document disagree. That window is exactly one gesture long and nothing
 * else reads position during it.
 */

/** What a workflow node's `data` carries into our own node components. */
export interface FlowNodeData extends Record<string, unknown> {
  readonly kind: WorkflowNode['kind']
  readonly detail: string
  /** True when nothing reaches this node from a trigger — rendered as a warning, not an error. */
  readonly unreachable: boolean
}

export type WorkflowFlowNode = FlowNode<FlowNodeData>

const str = (props: Readonly<Record<string, unknown>>, key: string): string =>
  typeof props[key] === 'string' ? props[key] : ''

const num = (props: Readonly<Record<string, unknown>>, key: string): number =>
  typeof props[key] === 'number' && Number.isFinite(props[key]) ? props[key] : 0

/**
 * The graph a document describes, in domain terms.
 *
 * The bridge between the engine's `DocumentSnapshot` and `topology/graph`'s rules. Every legality
 * question the builder asks goes through here first, so the rules never learn what a document node
 * looks like and the document never learns what a trigger is.
 */
export const graphOf = (document: DocumentSnapshot): WorkflowGraph => {
  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []

  for (const id of document.rootIds) {
    const node = document.nodes[id]
    if (node === undefined) continue

    if (isEdge(node)) {
      edges.push({
        id: id,
        from: str(node.props, 'from'),
        port: portOf(node.props),
        to: str(node.props, 'to'),
      })
      continue
    }
    if (!isStep(node)) continue

    nodes.push({
      id: id,
      kind: node.type as WorkflowNode['kind'],
      detail: str(node.props, 'detail'),
      x: num(node.props, 'x'),
      y: num(node.props, 'y'),
    })
  }

  return { nodes, edges }
}

const portOf = (props: Readonly<Record<string, unknown>>): OutputPort => {
  const value = props['port']
  return value === 'true' || value === 'false' ? value : 'out'
}

export interface FlowView {
  readonly nodes: readonly WorkflowFlowNode[]
  readonly edges: readonly Edge[]
}

/**
 * The React Flow view of a graph.
 *
 * `unreachableIds` is passed in rather than computed here, because `problemsOf` walks the whole
 * graph and this function runs on every render. The builder computes it once per document change.
 */
export const toFlow = (
  graph: WorkflowGraph,
  unreachableIds: ReadonlySet<string> = new Set(),
): FlowView => ({
  nodes: graph.nodes.map(
    (node): WorkflowFlowNode => ({
      id: node.id,
      // Our own components, registered as `nodeTypes`. React Flow renders them; it does not know
      // what they mean.
      type: node.kind,
      position: { x: node.x, y: node.y },
      data: { kind: node.kind, detail: node.detail, unreachable: unreachableIds.has(node.id) },
    }),
  ),
  edges: graph.edges.map(
    (edge): Edge => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      // The handle IS the branch. A condition renders two source handles, `true` and `false`, and
      // which one an edge leaves from is the only thing distinguishing the branches.
      sourceHandle: edge.port,
      // Labelled at the handle rather than on the edge: an edge label sits at the midpoint, which
      // is nowhere near the decision it describes once the nodes are more than a little apart.
      type: 'smoothstep',
    }),
  ),
})

/** The node type map key for an edge document node — exported so tests cannot drift from it. */
export const EDGE_DOCUMENT_TYPE = EDGE_NODE
