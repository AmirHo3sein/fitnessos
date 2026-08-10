import {
  acceptsInput,
  edgesFrom,
  nodeById,
  outputsOf,
  type OutputPort,
  type WorkflowGraph,
} from '../domain/Workflow'

/**
 * Graph legality — owned by this context, NOT by `editor-engine`.
 *
 * Handbook D-11 deletes `topology/graph` from the engine, and the reason is the same one that
 * moved `topology/temporal` into `ctx-timeline`: every rule below is a statement about what a
 * coaching automation means, not about what a graph is. "Nothing connects into a trigger" is
 * domain knowledge. An engine that knew it would be an engine that knew about triggers.
 *
 * ## The rules, and why each one is a refusal rather than a correction
 *
 * The report canvas displaces overlapping tiles; the grid pushes widgets down. Neither applies
 * here, because there is no repair for an illegal edge that preserves the coach's intent — an edge
 * into a trigger has no nearby legal position, it is simply not a thing. So `canConnect` answers
 * yes or no and the caller tells the user, which is the same stance `placeSpan` takes in
 * `ctx-timeline` and for the same reason.
 *
 *   ports-exist      an edge from a port the kind does not offer cannot be drawn, so this can only
 *                    arrive from a bug or from a document authored elsewhere
 *   trigger-input    a trigger begins a run; nothing precedes it
 *   self-loop        an immediate special case of the cycle rule, separated only so the message
 *                    can be specific — "a step cannot follow itself" reads better than "cycle"
 *   cycle            there is no iteration in the execution model, so a loop is a workflow that
 *                    cannot run rather than one that runs forever
 *   port-taken       one edge per OUTPUT port. Two edges from `true` is ambiguous about order and
 *                    there is no parallelism to fall back on
 *   duplicate        the same edge twice is a no-op that doubles every subsequent count
 *
 * **Fan-in is legal and deliberately so.** Two branches converging on one action is exactly how a
 * coach expresses "either way, flag them" — the target runs when whichever branch reaches it, and
 * nothing about that is ambiguous. It is the reason this document is a graph rather than a tree,
 * and the reason `editor-engine`'s tree helpers are not what validates it.
 */

export type ConnectionRefusal =
  | 'missing-node'
  | 'unknown-port'
  | 'trigger-input'
  | 'self-loop'
  | 'cycle'
  | 'port-taken'
  | 'duplicate'

export type ConnectionVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: ConnectionRefusal }

const REFUSED = (refusal: ConnectionRefusal): ConnectionVerdict => ({ ok: false, refusal })
const ALLOWED: ConnectionVerdict = { ok: true }

export interface ProposedEdge {
  readonly from: string
  readonly port: OutputPort
  readonly to: string
}

/**
 * Whether an edge may be added.
 *
 * Checked in cheapest-first order, and `self-loop` before `cycle` only so the more specific
 * refusal wins — a self-loop satisfies the cycle test too, and "cycle" would be a true but
 * unhelpful thing to tell someone who dropped a connector back on the node they started from.
 */
export const canConnect = (workflow: WorkflowGraph, edge: ProposedEdge): ConnectionVerdict => {
  const from = nodeById(workflow, edge.from)
  const to = nodeById(workflow, edge.to)
  if (from === null || to === null) return REFUSED('missing-node')

  if (!outputsOf(from.kind).includes(edge.port)) return REFUSED('unknown-port')
  if (!acceptsInput(to.kind)) return REFUSED('trigger-input')
  if (edge.from === edge.to) return REFUSED('self-loop')

  for (const existing of workflow.edges) {
    if (existing.from === edge.from && existing.to === edge.to && existing.port === edge.port) {
      return REFUSED('duplicate')
    }
    if (existing.from === edge.from && existing.port === edge.port) {
      return REFUSED('port-taken')
    }
  }

  // Last, because it is the only check that walks the graph. If the target can already reach the
  // source, adding source → target closes a loop.
  if (canReach(workflow, edge.to, edge.from)) return REFUSED('cycle')

  return ALLOWED
}

/**
 * Whether `to` is reachable from `from` by following edges forward.
 *
 * Iterative rather than recursive: a coach's workflow is small, but a document that arrived with a
 * cycle in it — from an older client, or a hand-edited payload — would blow the stack on a
 * recursive walk, and the whole point of this function is to be the thing that tolerates one.
 */
export const canReach = (workflow: WorkflowGraph, from: string, to: string): boolean => {
  const seen = new Set<string>()
  const queue: string[] = [from]
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const edge of edgesFrom(workflow, id)) queue.push(edge.to)
  }
  return false
}

/**
 * Which output ports of a node have nothing attached.
 *
 * Drives the builder's affordances: a condition with `true` already wired should offer only
 * `false`, so the coach discovers `port-taken` from what the UI shows rather than from a refusal
 * after the gesture. A refusal is a backstop, not the interface.
 */
export const freeOutputs = (workflow: WorkflowGraph, id: string): readonly OutputPort[] => {
  const node = nodeById(workflow, id)
  if (node === null) return []
  const taken = new Set(edgesFrom(workflow, id).map((edge) => edge.port))
  return outputsOf(node.kind).filter((port) => !taken.has(port))
}

/**
 * The nodes in execution order, or null if the graph contains a cycle.
 *
 * Kahn's algorithm. Not used to run anything — the backend does that — but it answers "is this
 * orderable at all", which is the same question `cycle` asks one edge at a time, asked of a whole
 * document. That matters when a document arrives from outside: `canConnect` guards every edge this
 * client adds and guards nothing about an edge that was already there.
 */
export const executionOrder = (workflow: WorkflowGraph): readonly string[] | null => {
  const indegree = new Map<string, number>()
  for (const node of workflow.nodes) indegree.set(node.id, 0)
  for (const edge of workflow.edges) {
    // Edges to unknown nodes are a dangling-edge problem, reported by `problemsOf`, and ignored
    // here rather than counted — counting one would leave a real node permanently blocked.
    if (indegree.has(edge.to)) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  }

  const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    order.push(id)
    for (const edge of edgesFrom(workflow, id)) {
      const next = indegree.get(edge.to)
      if (next === undefined) continue
      indegree.set(edge.to, next - 1)
      if (next - 1 === 0) queue.push(edge.to)
    }
  }

  return order.length === workflow.nodes.length ? order : null
}
