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

/** One timed batch. */
const timeBatch = (workflow: Workflow, iterations: number): number => {
  const started = performance.now()
  for (let i = 0; i < iterations; i += 1) problemsOf(workflow)
  return (performance.now() - started) / iterations
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

describe('problemsOf scales linearly', () => {
  // Explicit timeout for the same reason as `editor-engine`'s benchmarks: 2,000 iterations of the
  // small case plus 200 of the large, five times over, is not a 5 s default's business.
  it('an eightfold graph does not cost dramatically more than eightfold time', { timeout: 30_000 }, () => {
    const small = chain(50)
    const large = chain(400)

    /*
     * INTERLEAVED, and this test failed for want of it.
     *
     * The first version measured the small case five times, then the large case five times. Under a
     * full `pnpm check` — turbo building and testing eleven packages at once — load that arrived
     * during the second phase inflated all five of its samples and the median with them: it reported
     * 45.5× for an 8× graph and failed a gate in code nobody had touched.
     *
     * That is precisely the flaw I had just diagnosed and fixed in `editor-engine`'s two benchmarks,
     * left in place here. Alternating the two sizes inside one loop spreads contention across both
     * series, and the median then discards the sample that caught it.
     *
     * Iteration counts differ so both batches are well above timer resolution: without that the
     * ratio is dominated by the noise floor and the test passes while measuring nothing.
     */
    const smalls: number[] = []
    const larges: number[] = []
    for (let round = 0; round < 5; round += 1) {
      smalls.push(timeBatch(small, 2_000))
      larges.push(timeBatch(large, 200))
    }

    const smallPer = median(smalls)
    const largePer = median(larges)
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
