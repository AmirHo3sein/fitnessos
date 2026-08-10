import { describe, expect, it } from 'vitest'
import { problemsOf, type Workflow, type WorkflowNode } from '../domain/Workflow'

/**
 * `problemsOf` must stay LINEAR in the size of the graph.
 *
 * It is recomputed on every document change, which includes every keystroke in a step's detail
 * field, so a superlinear term here is felt as typing lag. The first implementation had one and was
 * not obviously wrong to read: a linear `find` per edge, plus a separate breadth-first search per
 * node whose inner edge lookup was itself a linear filter. Measured per call: 0.07 ms at 20 nodes,
 * 2.3 ms at 100, 9.3 ms at 200, 71 ms at 400.
 *
 * ## Why a RATIO and not a millisecond budget
 *
 * An absolute budget measures the machine. This suite already contains one lesson of that kind — a
 * spatial-query test that compared result counts and would have passed against a deliberately
 * full-scanning implementation — so the assertion here is about SHAPE: an eightfold graph must not
 * cost dramatically more than eightfold time.
 *
 *   linear     ratio ≈ 8
 *   quadratic  ratio ≈ 64
 *   cubic      ratio ≈ 512
 *
 * The threshold sits at 24 — three times the linear expectation, which absorbs noise and allocation
 * variance while leaving quadratic nowhere to hide.
 */

const chain = (n: number): Workflow => {
  const nodes: WorkflowNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${String(i)}`,
    kind: i === 0 ? 'trigger' : 'action',
    detail: 'x',
    x: 0,
    y: 0,
  }))
  // A chain rather than a star: it is the worst case for reachability, since every node is one more
  // step from the trigger. A star would finish in one hop and hide exactly what this measures.
  const edges = Array.from({ length: n - 1 }, (_, i) => ({
    id: `e${String(i)}`,
    from: `n${String(i)}`,
    port: 'out' as const,
    to: `n${String(i + 1)}`,
  }))
  return { id: 'w', title: 'w', enabled: false, nodes, edges }
}

/** Median of several runs, because a single sample catches a GC pause as easily as a regression. */
const timePerCall = (workflow: Workflow, iterations: number): number => {
  const samples: number[] = []
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now()
    for (let i = 0; i < iterations; i += 1) problemsOf(workflow)
    samples.push((performance.now() - started) / iterations)
  }
  samples.sort((a, b) => a - b)
  return samples[2]!
}

describe('problemsOf scales linearly', () => {
  // Explicit timeout for the same reason as `editor-engine`'s benchmarks: 2,000 iterations of the
  // small case plus 200 of the large, five times over, is not a 5 s default's business.
  it('an eightfold graph does not cost dramatically more than eightfold time', { timeout: 30_000 }, () => {
    const small = chain(50)
    const large = chain(400)

    // Enough iterations that the small case is well above timer resolution — otherwise the ratio is
    // dominated by the noise floor and the test measures nothing, while still passing.
    const smallPer = timePerCall(small, 2_000)
    const largePer = timePerCall(large, 200)
    expect(smallPer).toBeGreaterThan(0)

    const ratio = largePer / smallPer
    // Reported so a failure says how bad rather than merely that it is bad.
    expect(ratio, `ratio was ${ratio.toFixed(1)}× for an 8× graph`).toBeLessThan(24)
  })

  it('still finds the problems it is supposed to, at size', () => {
    // A fast function that stopped answering correctly would pass the test above.
    const disconnected = chain(200)
    const orphan: WorkflowNode = { id: 'orphan', kind: 'action', detail: 'x', x: 0, y: 0 }
    const problems = problemsOf({ ...disconnected, nodes: [...disconnected.nodes, orphan] })

    expect(problems).toEqual([{ kind: 'unreachable', nodeId: 'orphan' }])
  })
})
