import { emptyDocument, type DocumentSnapshot, type Node, type NodeId } from '@fitnessos/editor-engine'
import type { OutputPort, WorkflowEdge, WorkflowNode } from '../domain/Workflow'

/**
 * The Workflow Builder's document schema (handbook D-09) — and the one place where a graph has to
 * live inside a document that is shaped like a tree.
 *
 * ## Edges are NODES, and why that is not a workaround
 *
 * `DocumentSnapshot` is `nodes` + `rootIds` + `childIds`. There is nowhere in it to put an edge,
 * and D-11 anticipated that by naming a `ConnectPorts` action for the engine to grow. This
 * implementation does something else, deliberately, and the deviation is recorded here rather than
 * discovered later:
 *
 *   **an edge is a document node of type `edge`, with `from`, `port` and `to` in its props.**
 *
 * The alternative was adding `edges` to `DocumentSnapshot` plus `ConnectPorts` / `DisconnectPorts`
 * with inverters. That changes the snapshot shape every one of the six existing editors hydrates
 * into, every property test, and the history fuzzer — to gain nothing this does not already have,
 * because an edge as a node gets undo, redo, coalescing suppression and subtree capture from the
 * actions that exist. Phase 5's exit gate is "engine surface stable for 8 weeks"; spending that
 * stability on a representation change with no behavioural difference would be the wrong trade.
 *
 * What is genuinely given up: the engine cannot enforce anything about edges. It cannot, either
 * way — legality is `topology/graph`'s job by D-11, and the engine is not allowed to know what a
 * trigger is. So the loss is theoretical and the enforcement point is unchanged.
 *
 * ## Everything is a root
 *
 * `childIds` is empty for every node. A graph's structure is in its edges, and putting an action
 * "inside" the condition that reaches it would be a lie the moment a second branch converged on
 * it — fan-in is legal here (see `topology/graph`), so no single parent exists to nest under.
 * Two nodes both reaching one action is the case a tree cannot hold, which is exactly why this
 * document does not try.
 */

export const WORKFLOW_SCHEMA_ID = 'workflow'
export const WORKFLOW_SCHEMA_VERSION = 1

export const TRIGGER_NODE = 'trigger'
export const CONDITION_NODE = 'condition'
export const ACTION_NODE = 'action'
export const EDGE_NODE = 'edge'

/** The three node types that are steps. An `edge` node is not one, and must never be counted as one. */
export const STEP_TYPES: readonly string[] = [TRIGGER_NODE, CONDITION_NODE, ACTION_NODE]

export const isStep = (node: Node): boolean => STEP_TYPES.includes(node.type)
export const isEdge = (node: Node): boolean => node.type === EDGE_NODE

export interface PreservedWorkflowFields {
  readonly id: string
  readonly title: string
  readonly enabled: boolean
}

export interface WorkflowSnapshot {
  readonly id: string
  readonly title: string
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
  readonly enabled: boolean
}

export interface WorkflowDraft {
  readonly document: DocumentSnapshot
  readonly preserved: PreservedWorkflowFields
}

/**
 * D-09's coverage record: every field of the snapshot accounted for, so a field added to the
 * contract cannot be silently dropped by a round trip.
 *
 * `enabled` is preserved rather than editable in the document because turning a workflow on is not
 * an edit to its graph. It is also the one field whose legality depends on the whole document
 * (`isRunnable`), and a property the history could undo into an enabled-but-broken state is worse
 * than one the builder sets explicitly.
 */
export const HYDRATE_COVERAGE: Record<keyof WorkflowSnapshot, 'document' | 'preserved'> = {
  nodes: 'document',
  edges: 'document',
  id: 'preserved',
  title: 'preserved',
  enabled: 'preserved',
}

const str = (props: Readonly<Record<string, unknown>>, key: string): string =>
  typeof props[key] === 'string' ? props[key] : ''

const num = (props: Readonly<Record<string, unknown>>, key: string): number =>
  typeof props[key] === 'number' && Number.isFinite(props[key]) ? props[key] : 0

const port = (props: Readonly<Record<string, unknown>>): OutputPort => {
  const value = props['port']
  return value === 'true' || value === 'false' ? value : 'out'
}

export const hydrate = (snapshot: WorkflowSnapshot): WorkflowDraft => {
  const document = emptyDocument(WORKFLOW_SCHEMA_ID, WORKFLOW_SCHEMA_VERSION)

  const nodes: Record<string, Node> = {}
  const childIds: Record<string, readonly NodeId[]> = {}
  const rootIds: NodeId[] = []

  for (const step of snapshot.nodes) {
    const nodeId = step.id as NodeId
    nodes[nodeId] = {
      id: nodeId,
      type: step.kind,
      props: { detail: step.detail, x: step.x, y: step.y },
    }
    childIds[nodeId] = []
    rootIds.push(nodeId)
  }

  for (const edge of snapshot.edges) {
    const edgeId = edge.id as NodeId
    nodes[edgeId] = {
      id: edgeId,
      type: EDGE_NODE,
      props: { from: edge.from, port: edge.port, to: edge.to },
    }
    childIds[edgeId] = []
    // Edges live in `rootIds` beside the steps. Order among them is meaningless — an edge's
    // position in the list says nothing, unlike a meal's — so nothing derives from it and nothing
    // may start to. `commit` reads types, never positions.
    rootIds.push(edgeId)
  }

  return {
    document: { ...document, nodes, childIds, rootIds },
    preserved: { id: snapshot.id, title: snapshot.title, enabled: snapshot.enabled },
  }
}

export const commit = (draft: WorkflowDraft): WorkflowSnapshot => {
  const steps: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []

  for (const id of draft.document.rootIds) {
    const node = draft.document.nodes[id]
    if (node === undefined) continue

    if (isEdge(node)) {
      edges.push({
        id,
        from: str(node.props, 'from'),
        port: port(node.props),
        to: str(node.props, 'to'),
      })
      continue
    }

    if (!isStep(node)) continue
    steps.push({
      id,
      // The type IS the kind. Storing it in props as well would be a second source for one fact,
      // and the pair would drift the first time only one was updated.
      kind: node.type as WorkflowNode['kind'],
      detail: str(node.props, 'detail'),
      x: num(node.props, 'x'),
      y: num(node.props, 'y'),
    })
  }

  return { ...draft.preserved, nodes: steps, edges }
}

/**
 * Strip what a round trip is not required to preserve.
 *
 * Nothing, as it happens — unlike every other editor here, where `order` is derived. A workflow's
 * nodes carry their own coordinates and its edges carry their own endpoints, so hydrate/commit is
 * expected to be an exact identity on both. The function exists so the property test reads the
 * same as its five siblings, and its emptiness is the finding: a graph has no positional facts to
 * normalise, which is the same reason its `rootIds` order means nothing.
 */
export const normalize = (snapshot: WorkflowSnapshot): WorkflowSnapshot => snapshot
