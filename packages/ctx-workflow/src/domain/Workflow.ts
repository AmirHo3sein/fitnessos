
/**
 * Workflow — a coach's automation, as a graph.
 *
 * "When a check-in is submitted, if readiness is below four, flag the athlete for review." Three
 * nodes and two edges. That is the whole shape of the thing, and it is the first document in this
 * codebase whose structure is NOT a tree: an action can be reached from either branch of a
 * condition, so a node may have two parents. Every other editor here is a list or a list of lists.
 *
 * ## What is deliberately not here
 *
 * **No execution.** Nothing in this package runs a workflow; the backend does. The client authors
 * one and validates that what it authored is runnable, which is a different and much smaller job.
 * A client-side interpreter would be a second implementation of the semantics, and the two would
 * disagree the first time either changed.
 *
 * **No iteration, and no parallelism.** There is no loop node and no fan-out from one output, so
 * a workflow is a finite branching sequence. Both are enforced by `topology/graph`, and both are
 * enforced rather than merely documented because the backend has no semantics for either — a
 * client that could author one would be authoring something that cannot run.
 */

export type WorkflowNodeKind = 'trigger' | 'condition' | 'action'

/**
 * The port an edge leaves from.
 *
 * A trigger and an action have one way out; a condition has two, and which one an edge leaves
 * from IS the branch. Modelling it as a port rather than as a property of the edge means the
 * legality check can ask a node kind what it offers, instead of every caller knowing the rule.
 */
export type OutputPort = 'out' | 'true' | 'false'

export interface WorkflowNode {
  readonly id: string
  readonly kind: WorkflowNodeKind
  /**
   * Which event, comparison, or effect. Free text at this layer: the vocabulary belongs to the
   * backend that runs the workflow, and duplicating it here would create a second list to keep in
   * step. The builder offers a select; an unrecognised value renders as itself rather than as a
   * blank, so a workflow authored against a newer vocabulary is still readable.
   */
  readonly detail: string
  /** Flow coordinates — the same units React Flow uses before its viewport transform. */
  readonly x: number
  readonly y: number
}

export interface WorkflowEdge {
  readonly id: string
  readonly from: string
  readonly port: OutputPort
  readonly to: string
}

/**
 * Just the graph.
 *
 * Every rule in `topology/graph` and every question below is about nodes and edges alone, so they
 * take this rather than a whole `Workflow`. The reason is practical: the editor asks "may these two
 * connect?" about a document mid-edit, which has no id, title or enabled flag of its own — those
 * live in the draft's preserved fields. Requiring the aggregate would mean fabricating them at
 * every call site, and a fabricated id is the kind of thing that ends up saved.
 */
export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
}

export interface Workflow extends WorkflowGraph {
  readonly id: string
  readonly title: string
  /**
   * Whether the coach has turned it on.
   *
   * Held here rather than inferred from validity, because those are different questions. A
   * workflow can be complete and switched off, and a coach half-way through authoring one has an
   * incomplete workflow they have not enabled. Conflating them would either run drafts or refuse
   * to save them.
   */
  readonly enabled: boolean
}

/** Which output ports a kind offers. The single source of the rule. */
export const outputsOf = (kind: WorkflowNodeKind): readonly OutputPort[] => {
  switch (kind) {
    case 'trigger':
      return ['out']
    case 'condition':
      return ['true', 'false']
    case 'action':
      return ['out']
  }
}

/**
 * Whether a kind accepts an incoming edge at all.
 *
 * Only triggers refuse. A trigger is where a run STARTS — an edge into one would mean something
 * happened before the thing that begins the workflow, which has no meaning the backend could act
 * on. This is the rule the Workflow Builder's refusal message is about.
 */
export const acceptsInput = (kind: WorkflowNodeKind): boolean => kind !== 'trigger'

export const nodeById = (workflow: WorkflowGraph, id: string): WorkflowNode | null =>
  workflow.nodes.find((node) => node.id === id) ?? null

export const edgesFrom = (workflow: WorkflowGraph, id: string): readonly WorkflowEdge[] =>
  workflow.edges.filter((edge) => edge.from === id)

export const edgesTo = (workflow: WorkflowGraph, id: string): readonly WorkflowEdge[] =>
  workflow.edges.filter((edge) => edge.to === id)

/** Every edge touching a node, in either direction. What a deletion has to take with it. */
export const edgesTouching = (workflow: WorkflowGraph, id: string): readonly WorkflowEdge[] =>
  workflow.edges.filter((edge) => edge.from === id || edge.to === id)

export type WorkflowProblem =
  | { readonly kind: 'no-trigger' }
  | { readonly kind: 'unreachable'; readonly nodeId: string }
  | { readonly kind: 'dangling-edge'; readonly edgeId: string }
  | { readonly kind: 'unknown-port'; readonly edgeId: string }

/**
 * What is wrong with a workflow, as data.
 *
 * Returned rather than thrown, and returned as codes rather than sentences, because two different
 * callers need it: the builder renders these beside the nodes they concern, and the enable switch
 * refuses on a non-empty list. Neither wants an exception, and neither wants Persian from the
 * domain layer.
 *
 * ## Why an incomplete workflow is still saveable
 *
 * Authoring is incremental — a coach drops a condition, then wires it, then fills it in. Refusing
 * to save until the graph is whole would mean losing work at every intermediate step, which is
 * the same mistake as a form that clears itself on a validation error. So these are problems that
 * block ENABLING, not problems that block saving. The one thing genuinely refused at author time
 * is an illegal EDGE, because an edge that cannot exist has no intermediate state worth keeping.
 */
export const problemsOf = (workflow: WorkflowGraph): readonly WorkflowProblem[] => {
  const problems: WorkflowProblem[] = []

  /*
   * Indexed once, and this replaced a genuinely bad shape.
   *
   * The first version looked innocent and was cubic: `nodeById` was a linear `find` called per edge,
   * and reachability ran a SEPARATE breadth-first search per node, each of whose inner `edgesFrom`
   * was itself a linear filter over every edge. Measured, per call: 0.07 ms at 20 nodes, 2.3 ms at
   * 100, 9.3 ms at 200, 71 ms at 400.
   *
   * It was not a live bug — a coach's automation is ten or twenty steps, where the old version cost
   * 0.07 ms and nobody would ever have noticed. What made it worth fixing anyway is WHERE it runs:
   * `problemsOf` is recomputed on every document change, which includes every keystroke in a step's
   * detail field. A latent cubic term on the typing path is the kind of thing that is cheap to remove
   * now and expensive to diagnose later, when the symptom is "the builder feels slow on big ones".
   */
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, WorkflowEdge[]>()
  for (const edge of workflow.edges) {
    const list = outgoing.get(edge.from)
    if (list === undefined) outgoing.set(edge.from, [edge])
    else list.push(edge)
  }

  for (const edge of workflow.edges) {
    const from = byId.get(edge.from)
    if (from === undefined || !byId.has(edge.to)) {
      problems.push({ kind: 'dangling-edge', edgeId: edge.id })
      continue
    }
    if (!outputsOf(from.kind).includes(edge.port)) {
      problems.push({ kind: 'unknown-port', edgeId: edge.id })
    }
  }

  const triggers = workflow.nodes.filter((node) => node.kind === 'trigger')
  if (triggers.length === 0) problems.push({ kind: 'no-trigger' })

  // ONE traversal for the whole graph, not one per node.
  const reached = reachableFrom(triggers, outgoing)
  for (const node of workflow.nodes) {
    if (!reached.has(node.id)) {
      // Not an error while authoring — a branch built before it is wired is normal. It is an error
      // to ENABLE, because a node nothing reaches never runs and looks like it does.
      problems.push({ kind: 'unreachable', nodeId: node.id })
    }
  }

  return problems
}

/**
 * Every node any trigger can reach, in one breadth-first pass.
 *
 * Takes the adjacency index rather than the graph, so the caller cannot accidentally reintroduce the
 * linear edge scan this exists to remove. Cycle-safe by the `seen` set, which matters because a
 * document that arrived from elsewhere may contain a cycle this client could not have authored.
 */
const reachableFrom = (
  triggers: readonly WorkflowNode[],
  outgoing: ReadonlyMap<string, readonly WorkflowEdge[]>,
): ReadonlySet<string> => {
  const seen = new Set<string>()
  const queue = triggers.map((node) => node.id)
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    if (seen.has(id)) continue
    seen.add(id)
    for (const edge of outgoing.get(id) ?? []) queue.push(edge.to)
  }
  return seen
}

export const isRunnable = (workflow: WorkflowGraph): boolean => problemsOf(workflow).length === 0
