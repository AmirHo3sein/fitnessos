import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  edgesTouching,
  isRunnable,
  outputsOf,
  problemsOf,
  type OutputPort,
  type Workflow,
  type WorkflowNode,
} from '../domain/Workflow'
import { canConnect, canReach, executionOrder, freeOutputs } from './graph'

const node = (
  s: string,
  kind: WorkflowNode['kind'],
  detail = kind,
): WorkflowNode => ({ id: s, kind, detail, x: 0, y: 0 })

const workflow = (
  nodes: readonly WorkflowNode[],
  edges: readonly { from: string; port: OutputPort; to: string }[] = [],
): Workflow => ({
  id: 'w',
  title: 'w',
  nodes,
  edges: edges.map((e, i) => ({
    id: `e${String(i)}`,
    from: e.from,
    port: e.port,
    to: e.to,
  })),
  enabled: false,
})

const LINE = workflow(
  [node('t', 'trigger'), node('c', 'condition'), node('a', 'action')],
  [
    { from: 't', port: 'out', to: 'c' },
    { from: 'c', port: 'true', to: 'a' },
  ],
)

describe('what may be connected', () => {
  it('allows a trigger into a condition', () => {
    const w = workflow([node('t', 'trigger'), node('c', 'condition')])
    expect(canConnect(w, { from: 't', port: 'out', to: 'c' })).toEqual({ ok: true })
  })

  it('REFUSES an edge into a trigger', () => {
    /**
     * The rule the handbook names as a required end-to-end assertion, tested here first because
     * this is where it lives. A trigger is where a run starts; an edge into one would mean
     * something happened before the thing that begins the workflow.
     */
    const w = workflow([node('t', 'trigger'), node('a', 'action')])
    expect(canConnect(w, { from: 'a', port: 'out', to: 't' })).toEqual({
      ok: false,
      refusal: 'trigger-input',
    })
  })

  it('refuses a self-loop with a specific reason, not "cycle"', () => {
    // Both are true. "A step cannot follow itself" is the one a person can act on.
    const w = workflow([node('a', 'action')])
    expect(canConnect(w, { from: 'a', port: 'out', to: 'a' })).toEqual({
      ok: false,
      refusal: 'self-loop',
    })
  })

  it('refuses an edge that would close a loop', () => {
    // There is no iteration in the execution model, so this is a workflow that cannot run rather
    // than one that runs forever.
    expect(canConnect(LINE, { from: 'a', port: 'out', to: 'c' })).toEqual({
      ok: false,
      refusal: 'cycle',
    })
  })

  it('refuses a second edge from the same output port', () => {
    // Ambiguous about order, with no parallelism to fall back on.
    const w = workflow(
      [node('c', 'condition'), node('a', 'action'), node('b', 'action')],
      [{ from: 'c', port: 'true', to: 'a' }],
    )
    expect(canConnect(w, { from: 'c', port: 'true', to: 'b' })).toEqual({
      ok: false,
      refusal: 'port-taken',
    })
  })

  it('allows the OTHER branch of the same condition', () => {
    // The port is what makes a condition a branch. Refusing here would make conditions useless.
    const w = workflow(
      [node('c', 'condition'), node('a', 'action'), node('b', 'action')],
      [{ from: 'c', port: 'true', to: 'a' }],
    )
    expect(canConnect(w, { from: 'c', port: 'false', to: 'b' })).toEqual({ ok: true })
  })

  it('ALLOWS fan-in — two branches converging on one action', () => {
    /**
     * The reason this document is a graph and not a tree. "Either way, flag them" is a thing a
     * coach means, the target runs when whichever branch reaches it, and nothing about it is
     * ambiguous. A tree-shaped document could not hold it.
     */
    const w = workflow(
      [node('c', 'condition'), node('d', 'condition'), node('a', 'action')],
      [{ from: 'c', port: 'true', to: 'a' }],
    )
    expect(canConnect(w, { from: 'd', port: 'true', to: 'a' })).toEqual({ ok: true })
  })

  it('refuses a port the kind does not have', () => {
    // Undrawable in the UI, so it can only arrive from a bug or from a document authored elsewhere.
    const w = workflow([node('t', 'trigger'), node('a', 'action')])
    expect(canConnect(w, { from: 't', port: 'true', to: 'a' })).toEqual({
      ok: false,
      refusal: 'unknown-port',
    })
  })

  it('refuses an edge to a node that is not there', () => {
    const w = workflow([node('t', 'trigger')])
    expect(canConnect(w, { from: 't', port: 'out', to: 'gone' })).toEqual({
      ok: false,
      refusal: 'missing-node',
    })
  })

  it('reports a duplicate as a duplicate, not as a taken port', () => {
    // Same edge twice is a no-op; the same port to somewhere ELSE is a real conflict. Telling them
    // apart is the difference between "you already did that" and "that port is in use".
    const w = workflow(
      [node('t', 'trigger'), node('a', 'action')],
      [{ from: 't', port: 'out', to: 'a' }],
    )
    expect(canConnect(w, { from: 't', port: 'out', to: 'a' })).toEqual({
      ok: false,
      refusal: 'duplicate',
    })
  })
})

describe('free outputs drive what the builder offers', () => {
  it('hides a port that is already wired', () => {
    const w = workflow(
      [node('c', 'condition'), node('a', 'action')],
      [{ from: 'c', port: 'true', to: 'a' }],
    )
    expect(freeOutputs(w, 'c')).toEqual(['false'])
  })

  it('agrees with canConnect — a free port is connectable, a taken one is not', () => {
    /**
     * The invariant that keeps the affordance honest. If these two disagreed, the UI would either
     * offer a port that then refuses, or hide one that would have worked.
     */
    const w = workflow(
      [node('c', 'condition'), node('a', 'action'), node('b', 'action')],
      [{ from: 'c', port: 'true', to: 'a' }],
    )
    for (const port of outputsOf('condition')) {
      const free = freeOutputs(w, 'c').includes(port)
      const verdict = canConnect(w, { from: 'c', port, to: 'b' })
      expect(verdict.ok).toBe(free)
    }
  })
})

describe('reachability and order', () => {
  it('finds a path forward and not backward', () => {
    expect(canReach(LINE, 't', 'a')).toBe(true)
    expect(canReach(LINE, 'a', 't')).toBe(false)
  })

  it('terminates on a graph that already contains a cycle', () => {
    // Such a document cannot be authored by this client, and can arrive from one that could.
    const cyclic = workflow(
      [node('a', 'action'), node('b', 'action')],
      [
        { from: 'a', port: 'out', to: 'b' },
        { from: 'b', port: 'out', to: 'a' },
      ],
    )
    expect(canReach(cyclic, 'a', 'zz')).toBe(false)
    expect(executionOrder(cyclic)).toBeNull()
  })

  it('orders a line, and puts the trigger first', () => {
    expect(executionOrder(LINE)).toEqual(['t', 'c', 'a'])
  })

  it('ignores an edge to a node that is not there rather than blocking a real one', () => {
    // Counting a dangling edge's indegree would leave `a` permanently unorderable, turning a
    // reportable data problem into "this workflow contains a cycle", which it does not.
    const w = workflow(
      [node('t', 'trigger'), node('a', 'action')],
      [
        { from: 't', port: 'out', to: 'a' },
        { from: 't', port: 'out', to: 'gone' },
      ],
    )
    expect(executionOrder(w)).toEqual(['t', 'a'])
  })
})

describe('what blocks enabling', () => {
  it('a complete line is runnable', () => {
    expect(problemsOf(LINE)).toEqual([])
    expect(isRunnable(LINE)).toBe(true)
  })

  it('a workflow with no trigger is not', () => {
    const w = workflow([node('a', 'action')])
    expect(problemsOf(w)).toContainEqual({ kind: 'no-trigger' })
  })

  it('an unwired node is reported, but only as unreachable', () => {
    // Normal while authoring — a branch built before it is wired. It blocks enabling, not saving,
    // because a node nothing reaches never runs while looking exactly like it does.
    const w = workflow([node('t', 'trigger'), node('a', 'action')])
    expect(problemsOf(w)).toContainEqual({ kind: 'unreachable', nodeId: 'a' })
    expect(isRunnable(w)).toBe(false)
  })

  it('a trigger is always reachable — from itself', () => {
    // Off-by-one bait: a breadth-first walk that expanded before comparing would report every
    // trigger as unreachable, and no workflow would ever be enableable.
    const w = workflow([node('t', 'trigger')])
    expect(problemsOf(w).filter((p) => p.kind === 'unreachable')).toEqual([])
  })

  it('reports a dangling edge without also inventing a port problem', () => {
    const w = workflow([node('t', 'trigger')], [{ from: 't', port: 'out', to: 'gone' }])
    expect(problemsOf(w)).toContainEqual({ kind: 'dangling-edge', edgeId: 'e0' })
    expect(problemsOf(w).filter((p) => p.kind === 'unknown-port')).toEqual([])
  })
})

describe('deleting a node', () => {
  it('names every edge that touches it, in both directions', () => {
    // Leaving one behind produces a dangling edge, which `problemsOf` would then report against a
    // workflow the coach did nothing wrong to.
    expect(edgesTouching(LINE, 'c').map((e) => e.id)).toEqual(['e0', 'e1'])
  })
})

describe('properties', () => {
  const kinds = ['trigger', 'condition', 'action'] as const

  /** Small random graphs, built only from edges `canConnect` allowed. */
  const legalGraph = fc
    .array(fc.constantFrom(...kinds), { minLength: 1, maxLength: 6 })
    .chain((kindList) => {
      const nodes = kindList.map((kind, i) => node(`n${String(i)}`, kind))
      return fc
        .array(
          fc.record({
            from: fc.integer({ min: 0, max: nodes.length - 1 }),
            to: fc.integer({ min: 0, max: nodes.length - 1 }),
            port: fc.constantFrom<OutputPort>('out', 'true', 'false'),
          }),
          { maxLength: 10 },
        )
        .map((attempts) => {
          let w = workflow(nodes)
          for (const attempt of attempts) {
            const from = nodes[attempt.from]!.id
            const to = nodes[attempt.to]!.id
            if (canConnect(w, { from, port: attempt.port, to }).ok) {
              w = {
                ...w,
                edges: [
                  ...w.edges,
                  { id: `e${String(w.edges.length)}`, from, port: attempt.port, to },
                ],
              }
            }
          }
          return w
        })
    })

  it('a graph built only from allowed edges is always orderable', () => {
    /**
     * The property that makes the per-edge cycle check worth trusting. `canConnect` refuses one
     * edge at a time with local knowledge; this asserts the global consequence — no sequence of
     * individually-legal edges can produce a document `executionOrder` cannot linearise.
     */
    fc.assert(
      fc.property(legalGraph, (w) => {
        expect(executionOrder(w)).not.toBeNull()
      }),
      { numRuns: 300 },
    )
  })

  it('never has two edges leaving one port, however they were added', () => {
    fc.assert(
      fc.property(legalGraph, (w) => {
        const seen = new Set<string>()
        for (const edge of w.edges) {
          const key = `${edge.from}:${edge.port}`
          expect(seen.has(key)).toBe(false)
          seen.add(key)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('never has an edge into a trigger', () => {
    fc.assert(
      fc.property(legalGraph, (w) => {
        const triggers = new Set(w.nodes.filter((n) => n.kind === 'trigger').map((n) => n.id))
        for (const edge of w.edges) expect(triggers.has(edge.to)).toBe(false)
      }),
      { numRuns: 300 },
    )
  })

  it('freeOutputs and canConnect never disagree', () => {
    // Stated as a property because the builder relies on it for every affordance it draws: a port
    // it offers must connect, and a port it hides must refuse.
    fc.assert(
      fc.property(legalGraph, (w) => {
        for (const from of w.nodes) {
          const free = new Set(freeOutputs(w, from.id))
          for (const port of outputsOf(from.kind)) {
            const target = w.nodes.find(
              (n) => n.id !== from.id && n.kind !== 'trigger' && !canReach(w, n.id, from.id),
            )
            if (target === undefined) continue
            const verdict = canConnect(w, { from: from.id, port, to: target.id })
            if (!free.has(port)) expect(verdict.ok).toBe(false)
          }
        }
      }),
      { numRuns: 200 },
    )
  })
})
