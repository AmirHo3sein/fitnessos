import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HISTORY_CONFIG,
  applyAction,
  createHistory,
  invertAction,
  push,
  pushBatch,
  undo,
  type NodeId,
} from '@fitnessos/editor-engine'
import { edgesTouching, type OutputPort, type Workflow } from '../domain/Workflow'
import { canConnect } from '../topology/graph'
import {
  EDGE_NODE,
  HYDRATE_COVERAGE,
  commit,
  hydrate,
  isEdge,
  isStep,
  normalize,
  type WorkflowSnapshot,
} from './schema'

const KINDS = ['trigger', 'condition', 'action'] as const

const arbSnapshot: fc.Arbitrary<WorkflowSnapshot> = fc
  .array(
    fc.record({
      kind: fc.constantFrom(...KINDS),
      detail: fc.string(),
      x: fc.integer({ min: -2000, max: 2000 }),
      y: fc.integer({ min: -2000, max: 2000 }),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .chain((steps) => {
    const nodes = steps.map((step, i) => ({ ...step, id: `n${String(i)}` }))
    return fc
      .array(
        fc.record({
          from: fc.integer({ min: 0, max: nodes.length - 1 }),
          to: fc.integer({ min: 0, max: nodes.length - 1 }),
          port: fc.constantFrom<OutputPort>('out', 'true', 'false'),
        }),
        { maxLength: 8 },
      )
      .map((attempts) => {
        // Only edges `canConnect` allows, so the fixture is a document this client could author.
        let workflow: Workflow = {
          id: 'w',
          title: 'w',
          nodes,
          edges: [],
          enabled: false,
        }
        for (const attempt of attempts) {
          const from = nodes[attempt.from]!.id
          const to = nodes[attempt.to]!.id
          if (canConnect(workflow, { from, port: attempt.port, to }).ok) {
            workflow = {
              ...workflow,
              edges: [
                ...workflow.edges,
                { id: `e${String(workflow.edges.length)}`, from, port: attempt.port, to },
              ],
            }
          }
        }
        return { ...workflow, enabled: false } satisfies WorkflowSnapshot
      })
  })

describe('hydrate and commit', () => {
  it('round-trips a workflow exactly', () => {
    /**
     * D-09. Stricter here than in the other five editors: nothing is derived, so this is a true
     * identity rather than an identity-after-normalising. If a coordinate or an edge endpoint
     * changed shape in the document, this is the assertion that would say so.
     */
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        expect(commit(hydrate(snapshot))).toEqual(normalize(snapshot))
      }),
      { numRuns: 300 },
    )
  })

  it('normalize really is the identity, and that is a claim worth pinning', () => {
    // Every other editor derives `order` from position. A graph has no positional facts at all —
    // if that ever stops being true, this test fails and the reasoning in the schema is stale.
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        expect(normalize(snapshot)).toEqual(snapshot)
      }),
      { numRuns: 100 },
    )
  })

  it('accounts for every snapshot field', () => {
    const covered = Object.keys(HYDRATE_COVERAGE).sort()
    expect(covered).toEqual(['edges', 'enabled', 'id', 'nodes', 'title'])
  })

  it('keeps steps and edges apart in one flat rootIds', () => {
    // They share `rootIds`, so the ONLY thing separating a step from an edge is its type. A commit
    // that read positions instead would turn an edge into a node with a blank detail.
    const snapshot: WorkflowSnapshot = {
      id: 'w',
      title: 'w',
      enabled: false,
      nodes: [
        { id: 't', kind: 'trigger', detail: 'check-in', x: 10, y: 20 },
        { id: 'a', kind: 'action', detail: 'notify', x: 30, y: 40 },
      ],
      edges: [{ id: 'e', from: 't', port: 'out', to: 'a' }],
    }
    const draft = hydrate(snapshot)

    expect(draft.document.rootIds).toHaveLength(3)
    expect(Object.values(draft.document.nodes).filter(isStep)).toHaveLength(2)
    expect(Object.values(draft.document.nodes).filter(isEdge)).toHaveLength(1)
    expect(commit(draft)).toEqual(snapshot)
  })

  it('gives every node an empty child list — a graph nests nothing', () => {
    // Putting an action "inside" the condition that reaches it would be a lie the moment a second
    // branch converged on it, and fan-in is legal here.
    const draft = hydrate({
      id: 'w',
      title: 'w',
      enabled: false,
      nodes: [{ id: 't', kind: 'trigger', detail: 'x', x: 0, y: 0 }],
      edges: [],
    })
    expect(Object.values(draft.document.childIds).every((ids) => ids.length === 0)).toBe(true)
  })

  it('survives a document whose edge props are the wrong types', () => {
    // Not reachable from the builder; reachable from a stored document written by another version.
    // A NaN coordinate would place a node nowhere visible and a missing port would break the branch,
    // so both degrade to a defined value rather than propagating.
    const draft = hydrate({
      id: 'w',
      title: 'w',
      enabled: true,
      nodes: [{ id: 'n', kind: 'action', detail: 'a', x: 0, y: 0 }],
      edges: [],
    })
    const broken = {
      ...draft,
      document: {
        ...draft.document,
        nodes: {
          ...draft.document.nodes,
          ['n' as NodeId]: {
            id: 'n' as NodeId,
            type: 'action',
            props: { detail: 42, x: Number.NaN, y: null },
          },
        },
      },
    }
    expect(commit(broken).nodes[0]).toEqual({
      id: 'n',
      kind: 'action',
      detail: '',
      x: 0,
      y: 0,
    })
  })
})

describe('the history over a graph', () => {
  const base: WorkflowSnapshot = {
    id: 'w',
    title: 'w',
    enabled: false,
    nodes: [
      { id: 't', kind: 'trigger', detail: 'check-in', x: 0, y: 0 },
      { id: 'c', kind: 'condition', detail: 'readiness', x: 200, y: 0 },
      { id: 'a', kind: 'action', detail: 'notify', x: 400, y: 0 },
    ],
    edges: [
      { id: 'e0', from: 't', port: 'out', to: 'c' },
      { id: 'e1', from: 'c', port: 'true', to: 'a' },
    ],
  }

  it('undoes a connection as one entry', () => {
    // An edge is an `InsertNode`, so this is the engine's ordinary undo — the whole argument for
    // representing edges as nodes rather than growing a `ConnectPorts` action.
    const draft = hydrate({ ...base, edges: [] })
    let history = createHistory(draft.document, DEFAULT_HISTORY_CONFIG)
    history = push(
      history,
      {
        type: 'InsertNode',
        node: {
          id: 'e0' as NodeId,
          type: EDGE_NODE,
          props: { from: 't', port: 'out', to: 'c' },
        },
        parentId: null,
        index: 3,
      },
      { label: 'connect', at: 1000, id: 'h0' },
    )
    expect(commit({ ...draft, document: history.document }).edges).toHaveLength(1)

    history = undo(history)
    expect(commit({ ...draft, document: history.document }).edges).toEqual([])
  })

  it('removes a node and its edges as ONE undo entry', () => {
    /**
     * `pushBatch`. Deleting a condition has to take both edges with it or the document is left with
     * dangling ones — and the coach must not have to press undo three times to get back what one
     * gesture removed.
     *
     * This is also why `pushBatch` must never coalesce: the batch's inverse is three insertions in
     * reverse order, and merging it with a neighbouring edit would make undo remove things the
     * gesture never touched.
     */
    const draft = hydrate(base)
    const workflow: Workflow = { ...base, nodes: base.nodes, edges: base.edges }
    const doomed = edgesTouching(workflow, 'c')
    expect(doomed).toHaveLength(2)

    let history = createHistory(draft.document, DEFAULT_HISTORY_CONFIG)
    history = pushBatch(
      history,
      [
        ...doomed.map((edge) => ({ type: 'RemoveNode' as const, nodeId: edge.id as NodeId })),
        { type: 'RemoveNode' as const, nodeId: 'c' as NodeId },
      ],
      { label: 'remove step', at: 2000, id: 'h1' },
    )

    const after = commit({ ...draft, document: history.document })
    expect(after.nodes.map((n) => n.id)).toEqual(['t', 'a'])
    expect(after.edges).toEqual([])
    // ONE entry, not three: the coach made one gesture.
    expect(history.entries).toHaveLength(1)

    const restored = commit({ ...draft, document: undo(history).document })
    expect(restored.nodes.map((n) => n.id)).toEqual(['t', 'c', 'a'])
    expect(restored.edges.map((e) => e.id)).toEqual(['e0', 'e1'])
  })

  it('every action over this document is invertible', () => {
    /**
     * The engine's own guarantee, restated against a document shape it has not seen before: a flat
     * `rootIds` holding two different kinds of thing. `invertAction` is generic over the document,
     * so this is really asserting that nothing in this schema depends on `childIds` carrying
     * structure — which is what would break if the engine ever assumed a tree.
     */
    fc.assert(
      fc.property(arbSnapshot, (snapshot) => {
        const draft = hydrate(snapshot)
        const ids = draft.document.rootIds
        if (ids.length === 0) return
        const target = ids[0]!

        const action = { type: 'SetProperty' as const, nodeId: target, key: 'x', value: 999 }
        const forward = applyAction(draft.document, action)
        const back = applyAction(forward, invertAction(draft.document, action))
        expect(back).toEqual(draft.document)
      }),
      { numRuns: 200 },
    )
  })
})
