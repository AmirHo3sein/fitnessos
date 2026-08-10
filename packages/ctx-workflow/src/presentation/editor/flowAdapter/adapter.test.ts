import { describe, expect, it } from 'vitest'
import { hydrate, type WorkflowSnapshot } from '../../../editor/schema'
import {
  connectionActions,
  deleteEdgeActions,
  deleteStepActions,
  moveActions,
} from './fromFlow'
import { graphOf, toFlow } from './toFlow'

const snapshot: WorkflowSnapshot = {
  id: 'w',
  title: 'w',
  enabled: false,
  nodes: [
    { id: 't', kind: 'trigger', detail: 'check-in', x: 0, y: 40 },
    { id: 'c', kind: 'condition', detail: 'readiness', x: 240, y: 40 },
    { id: 'a', kind: 'action', detail: 'notify', x: 480, y: 0 },
    { id: 'b', kind: 'action', detail: 'nothing', x: 480, y: 120 },
  ],
  edges: [
    { id: 'e0', from: 't', port: 'out', to: 'c' },
    { id: 'e1', from: 'c', port: 'true', to: 'a' },
  ],
}

const graph = graphOf(hydrate(snapshot).document)

describe('the document is the source of truth', () => {
  it('reads a graph back out of a flat document holding two kinds of node', () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(['t', 'c', 'a', 'b'])
    expect(graph.edges.map((e) => `${e.from}-${e.port}->${e.to}`)).toEqual([
      't-out->c',
      'c-true->a',
    ])
  })

  it('turns it into React Flow nodes and edges', () => {
    const view = toFlow(graph)
    expect(view.nodes).toHaveLength(4)
    expect(view.edges).toHaveLength(2)
    expect(view.nodes[0]).toMatchObject({
      id: 't',
      type: 'trigger',
      position: { x: 0, y: 40 },
      data: { kind: 'trigger', detail: 'check-in' },
    })
  })

  it('carries the port as the source HANDLE, because the handle is the branch', () => {
    // Two edges leaving one condition are only distinguishable by which handle they left. Losing
    // this would render both branches as the same arrow and make `true`/`false` unauthorable.
    const view = toFlow(graph)
    expect(view.edges.find((e) => e.id === 'e1')?.sourceHandle).toBe('true')
  })

  it('marks unreachable nodes so they can be shown as a warning', () => {
    // `b` is wired to nothing. A coach who saves this has a step that never runs and looks exactly
    // like one that does.
    const view = toFlow(graph, new Set(['b']))
    expect(view.nodes.find((n) => n.id === 'b')?.data.unreachable).toBe(true)
    expect(view.nodes.find((n) => n.id === 'a')?.data.unreachable).toBe(false)
  })
})

describe('a drag', () => {
  it('becomes two property writes for one gesture', () => {
    expect(moveActions('t', { x: 120, y: 240 })).toEqual([
      { type: 'SetProperty', nodeId: 't', key: 'x', value: 120 },
      { type: 'SetProperty', nodeId: 't', key: 'y', value: 240 },
    ])
  })

  it('rounds, so a saved payload does not differ by floating-point noise', () => {
    // React Flow reports sub-pixel positions from a pointer drag. `312.00000000000006` in a payload
    // makes every save look like a change.
    expect(moveActions('t', { x: 312.00000000000006, y: -0.4 })).toEqual([
      { type: 'SetProperty', nodeId: 't', key: 'x', value: 312 },
      { type: 'SetProperty', nodeId: 't', key: 'y', value: -0 },
    ])
  })
})

describe('a connection gesture', () => {
  it('becomes an InsertNode of an edge document node', () => {
    const outcome = connectionActions(
      graph,
      { source: 'c', target: 'b', sourceHandle: 'false' },
      'new',
      6,
    )
    expect(outcome).toEqual({
      ok: true,
      actions: [
        {
          type: 'InsertNode',
          node: { id: 'new', type: 'edge', props: { from: 'c', port: 'false', to: 'b' } },
          parentId: null,
          index: 6,
        },
      ],
    })
  })

  it('REFUSES an edge into a trigger and produces no actions', () => {
    /**
     * The handbook's named required assertion, at the layer that decides it. React Flow would draw
     * this connection perfectly happily — the refusal is ours, and it has to be here rather than
     * only in `isValidConnection` because `isValidConnection` guards a gesture and this guards the
     * document.
     */
    const outcome = connectionActions(
      graph,
      { source: 'a', target: 't', sourceHandle: null },
      'new',
      6,
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.verdict).toEqual({ ok: false, refusal: 'trigger-input' })
  })

  it('refuses a second edge from a port that is already wired', () => {
    const outcome = connectionActions(
      graph,
      { source: 'c', target: 'b', sourceHandle: 'true' },
      'new',
      6,
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.verdict).toEqual({ ok: false, refusal: 'port-taken' })
  })

  it('refuses a connection that would close a loop', () => {
    const outcome = connectionActions(
      graph,
      { source: 'a', target: 'c', sourceHandle: null },
      'new',
      6,
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.verdict).toEqual({ ok: false, refusal: 'cycle' })
  })

  it('treats a null handle as the single output, which conditions still refuse', () => {
    /**
     * React Flow reports `null` for a handle on a node declaring exactly one — the common case for
     * triggers and actions. Defaulting keeps that off a React Flow implementation detail; the
     * default is safe rather than lenient because a condition has no `out` port, so the same
     * default that helps an action refuses a condition.
     */
    const fromAction = connectionActions(
      graph,
      { source: 'a', target: 'b', sourceHandle: null },
      'new',
      6,
    )
    expect(fromAction.ok).toBe(true)

    const fromCondition = connectionActions(
      { nodes: graph.nodes, edges: [] },
      { source: 'c', target: 'b', sourceHandle: null },
      'new',
      6,
    )
    expect(fromCondition.ok).toBe(false)
    if (!fromCondition.ok) {
      expect(fromCondition.verdict).toEqual({ ok: false, refusal: 'unknown-port' })
    }
  })

  it('treats a connection dropped on empty canvas as a non-event', () => {
    // Not an error the user should be told off about; they let go in the wrong place.
    const outcome = connectionActions(
      graph,
      { source: 'c', target: null, sourceHandle: 'false' },
      'new',
      6,
    )
    expect(outcome.ok).toBe(false)
  })
})

describe('a deletion', () => {
  it('takes the step and every edge touching it, edges first', () => {
    /**
     * Order matters twice. Forward, because removing the step first would leave edges pointing at
     * nothing. Backward, because `pushBatch` prepends each inverse — so undo re-inserts the step
     * before the edges that reference it.
     */
    expect(deleteStepActions(graph, 'c')).toEqual([
      { type: 'RemoveNode', nodeId: 'e0' },
      { type: 'RemoveNode', nodeId: 'e1' },
      { type: 'RemoveNode', nodeId: 'c' },
    ])
  })

  it('takes both directions, not only outgoing edges', () => {
    // `a` has one INCOMING edge and none outgoing. A cascade that only looked forward would leave
    // it behind, which is the easier half of this to get wrong.
    expect(deleteStepActions(graph, 'a')).toEqual([
      { type: 'RemoveNode', nodeId: 'e1' },
      { type: 'RemoveNode', nodeId: 'a' },
    ])
  })

  it('deletes an edge on its own with nothing to cascade', () => {
    expect(deleteEdgeActions('e0')).toEqual([{ type: 'RemoveNode', nodeId: 'e0' }])
  })
})
