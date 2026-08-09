import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applyAction, targetsOf, type EditorAction } from '../document/actions'
import { emptyDocument, type DocumentSnapshot, type Node, type NodeId } from '../document/snapshot'
import {
  DEFAULT_HISTORY_CONFIG,
  canRedo,
  canUndo,
  commitBoundary,
  createHistory,
  push,
  pushBatch,
  redo,
  undo,
} from './history'

const id = (n: string) => n as NodeId
const node = (n: string, props: Record<string, unknown> = {}): Node => ({
  id: id(n),
  type: 'block',
  props,
})

const withNodes = (...names: string[]): DocumentSnapshot => {
  let doc = emptyDocument('test')
  for (const [index, name] of names.entries()) {
    doc = applyAction(doc, { type: 'InsertNode', node: node(name), parentId: null, index })
  }
  return doc
}

let seq = 0
const opts = (label: string, at = 1000) => ({ label, at, id: `e${String(seq++)}` })

describe('undo and redo', () => {
  it('undo restores the previous value', () => {
    let h = createHistory(withNodes('a'))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'name', value: 'squat' }, opts('rename'))
    expect(h.document.nodes[id('a')]!.props['name']).toBe('squat')

    h = undo(h)
    expect(h.document.nodes[id('a')]!.props['name']).toBeUndefined()
  })

  it('redo reapplies it', () => {
    let h = createHistory(withNodes('a'))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'name', value: 'squat' }, opts('rename'))
    h = undo(h)
    h = redo(h)
    expect(h.document.nodes[id('a')]!.props['name']).toBe('squat')
  })

  it('restores a deleted SUBTREE, not just the node', () => {
    // The inverse has to capture the whole subtree at removal time. Recomputing on undo is
    // impossible — by then the children are gone.
    let doc = withNodes('parent')
    doc = applyAction(doc, { type: 'InsertNode', node: node('child'), parentId: id('parent'), index: 0 })
    doc = applyAction(doc, { type: 'InsertNode', node: node('grandchild'), parentId: id('child'), index: 0 })

    let h = createHistory(doc)
    h = push(h, { type: 'RemoveNode', nodeId: id('parent') }, opts('delete'))
    expect(h.document.nodes[id('grandchild')]).toBeUndefined()

    h = undo(h)
    expect(h.document.nodes[id('grandchild')]).toBeDefined()
    expect(h.document.childIds[id('child')]).toEqual([id('grandchild')])
  })

  it('restores a deleted node to its original POSITION', () => {
    let h = createHistory(withNodes('a', 'b', 'c'))
    h = push(h, { type: 'RemoveNode', nodeId: id('b') }, opts('delete'))
    h = undo(h)
    expect(h.document.rootIds).toEqual([id('a'), id('b'), id('c')])
  })

  it('reverses a multi-select move to each node’s own original place', () => {
    // MoveNodes sends everything to one parent; the inverse must restore three nodes to three
    // different homes. An earlier draft inverted a move with another move and scrambled this.
    let doc = withNodes('p1', 'p2')
    doc = applyAction(doc, { type: 'InsertNode', node: node('x'), parentId: id('p1'), index: 0 })
    doc = applyAction(doc, { type: 'InsertNode', node: node('y'), parentId: id('p2'), index: 0 })

    let h = createHistory(doc)
    h = push(h, { type: 'MoveNodes', nodeIds: [id('x'), id('y')], toParentId: null, toIndex: 0 }, opts('move'))
    expect(h.document.rootIds).toContain(id('x'))

    h = undo(h)
    expect(h.document.childIds[id('p1')]).toEqual([id('x')])
    expect(h.document.childIds[id('p2')]).toEqual([id('y')])
    expect(h.document.rootIds).toEqual([id('p1'), id('p2')])
  })

  it('does nothing when there is nothing to undo', () => {
    const h = createHistory(withNodes('a'))
    expect(canUndo(h)).toBe(false)
    expect(undo(h)).toBe(h)
  })

  it('discards the redo branch when a new edit follows an undo', () => {
    // Keeping it would need a tree, and a branching undo history is a feature almost no editor has
    // because almost no user wants it.
    let h = createHistory(withNodes('a'))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, opts('one'))
    h = undo(h)
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 2 }, opts('two'))

    expect(canRedo(h)).toBe(false)
    expect(h.document.nodes[id('a')]!.props['k']).toBe(2)
  })
})

describe('coalescing', () => {
  it('merges rapid edits to the same property into one entry', () => {
    // A user typing "squat" means one change, not five.
    let h = createHistory(withNodes('a'))
    for (const [i, value] of ['s', 'sq', 'squ', 'squa', 'squat'].entries()) {
      h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'name', value }, opts('type', 1000 + i * 50))
    }

    expect(h.entries).toHaveLength(1)
    h = undo(h)
    // All the way back, not to "squa".
    expect(h.document.nodes[id('a')]!.props['name']).toBeUndefined()
  })

  it('does NOT merge across the coalesce window', () => {
    let h = createHistory(withNodes('a'))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'name', value: 'a' }, opts('t', 1000))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'name', value: 'ab' }, opts('t', 1600))
    expect(h.entries).toHaveLength(2)
  })

  it('does NOT merge different targets', () => {
    let h = createHistory(withNodes('a', 'b'))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, opts('t', 1000))
    h = push(h, { type: 'SetProperty', nodeId: id('b'), key: 'k', value: 1 }, opts('t', 1010))
    expect(h.entries).toHaveLength(2)
  })

  it('NEVER merges structural actions', () => {
    // An undo that removes two nodes when the user expected one is how people learn to stop
    // trusting undo.
    let h = createHistory(emptyDocument('test'))
    h = push(h, { type: 'InsertNode', node: node('a'), parentId: null, index: 0 }, opts('add', 1000))
    h = push(h, { type: 'InsertNode', node: node('b'), parentId: null, index: 1 }, opts('add', 1010))

    expect(h.entries).toHaveLength(2)
    h = undo(h)
    expect(h.document.rootIds).toEqual([id('a')])
  })

  it('unwinds a coalesced entry in the right order', () => {
    // Inverses are stored newest-first; applying them in stored order is what makes the entry
    // unwind correctly. Appending instead of prepending is the classic bug here.
    let h = createHistory(withNodes('a'))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, opts('t', 1000))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 2 }, opts('t', 1050))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 3 }, opts('t', 1100))

    h = undo(h)
    expect(h.document.nodes[id('a')]!.props['k']).toBeUndefined()
  })
})

describe('commit boundaries', () => {
  it('blocks undo past a commit', () => {
    // Undoing past a commit would leave the local document in a state the server has never seen.
    let h = createHistory(withNodes('a'))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, opts('edit'))
    h = commitBoundary(h, 'commit-1', 2000)

    expect(canUndo(h)).toBe(false)
  })

  it('allows undo of work done AFTER the commit', () => {
    let h = createHistory(withNodes('a'))
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, opts('edit'))
    h = commitBoundary(h, 'commit-1', 2000)
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 2 }, opts('edit', 3000))

    expect(canUndo(h)).toBe(true)
    h = undo(h)
    expect(h.document.nodes[id('a')]!.props['k']).toBe(1)
  })

  it('does not coalesce an edit into a commit boundary', () => {
    let h = createHistory(withNodes('a'))
    h = commitBoundary(h, 'c', 1000)
    h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: 1 }, opts('edit', 1010))
    expect(h.entries).toHaveLength(2)
  })
})

describe('eviction and checkpoints', () => {
  const smallConfig = { maxEntries: 10, checkpointEvery: 5, coalesceWindowMs: 500 }

  it('caps the entry list', () => {
    let h = createHistory(withNodes('a'), smallConfig)
    for (let i = 0; i < 25; i += 1) {
      h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: i }, opts('e', 1000 + i * 1000))
    }
    expect(h.entries).toHaveLength(10)
  })

  it('keeps a checkpoint at the truncation boundary', () => {
    // Without it the oldest surviving entries are un-redoable: redo replays forward from a known
    // state, and there would be none.
    let h = createHistory(withNodes('a'), smallConfig)
    for (let i = 0; i < 25; i += 1) {
      h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: i }, opts('e', 1000 + i * 1000))
    }
    expect(h.checkpoints.some((c) => c.index === 0)).toBe(true)
  })

  it('still undoes correctly after eviction', () => {
    let h = createHistory(withNodes('a'), smallConfig)
    for (let i = 0; i < 25; i += 1) {
      h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: i }, opts('e', 1000 + i * 1000))
    }
    h = undo(h)
    expect(h.document.nodes[id('a')]!.props['k']).toBe(23)
  })

  it('writes a checkpoint on the configured interval', () => {
    let h = createHistory(withNodes('a'), { ...smallConfig, maxEntries: 100 })
    for (let i = 0; i < 12; i += 1) {
      h = push(h, { type: 'SetProperty', nodeId: id('a'), key: 'k', value: i }, opts('e', 1000 + i * 1000))
    }
    // One at construction, plus 5 and 10.
    expect(h.checkpoints.map((c) => c.index)).toEqual([0, 5, 10])
  })
})

describe('the round-trip property', () => {
  /**
   * The guarantee the whole design rests on: **applying any sequence of actions and then undoing
   * all of them returns the document exactly to where it started.**
   *
   * A property test rather than examples, because the failures here are combinational — a
   * particular order of insert, move and remove that no one would think to write by hand. This is
   * what fast-check is for.
   */
  /**
   * Ids an insertion may use, disjoint from the starting document.
   *
   * Disjoint on purpose: `InsertNode` with an id already present overwrites rather than inserts,
   * so a fuzzer that reused a name would be generating a case the action does not claim to
   * support and would fail for a reason that is not a bug.
   */
  const fresh = ['x', 'y', 'z']

  const arbAction = (names: readonly string[]): fc.Arbitrary<EditorAction> =>
    fc.oneof(
      fc.record({
        type: fc.constant('SetProperty' as const),
        nodeId: fc.constantFrom(...names).map(id),
        key: fc.constantFrom('name', 'colour', 'size'),
        value: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
      }),
      fc.record({
        type: fc.constant('RemoveNode' as const),
        nodeId: fc.constantFrom(...names).map(id),
      }),
      /*
       * Insertion, which this arbitrary did not generate until now.
       *
       * That was a real hole rather than an omission of convenience: `InsertNode` is one of the
       * three actions a builder issues constantly, its inverse is `RemoveNode`, and the
       * insert-then-undo path had only example coverage. A fuzzer that never inserts also never
       * produces the interleavings that matter — insert, move the inserted node, remove its old
       * sibling, undo all three.
       */
      fc.record({
        type: fc.constant('InsertNode' as const),
        node: fc.constantFrom(...fresh).map((n) => ({
          id: id(n),
          type: 'block',
          props: {},
        })),
        parentId: fc.constant(null),
        index: fc.integer({ min: 0, max: 3 }),
      }),
      fc.record({
        type: fc.constant('MoveNodes' as const),
        nodeIds: fc.constantFrom(...names, ...fresh).map((n) => [id(n)]),
        toParentId: fc.constant(null),
        toIndex: fc.integer({ min: 0, max: 3 }),
      }),
    )

  it('undoing every entry restores the starting document', () => {
    const names = ['a', 'b', 'c']

    fc.assert(
      fc.property(fc.array(arbAction(names), { maxLength: 12 }), (actions) => {
        const start = withNodes(...names)
        let h = createHistory(start, { ...DEFAULT_HISTORY_CONFIG, coalesceWindowMs: 0 })

        for (const [i, action] of actions.entries()) {
          // Skip actions whose target no longer exists — a real editor would not offer them, and
          // an action against a missing node is not a case the inverse contract covers.
          // `targetsOf` rather than a hand-rolled narrow: the union has six members and the
          // inline version only handled the three this arbitrary generates, so adding an action
          // would have silently stopped skipping.
          //
          // `InsertNode` is exempt, and has to be: its target is by definition absent, so the
          // guard would skip every insertion and the fuzzer would silently be the old one again.
          // An insert whose id IS present is skipped instead, since that overwrites.
          if (action.type === 'InsertNode') {
            if (h.document.nodes[action.node.id] !== undefined) continue
          } else if (targetsOf(action).some((t) => h.document.nodes[t] === undefined)) continue
          h = push(h, action, opts('a', 1000 + i * 10_000))
        }

        while (canUndo(h)) h = undo(h)

        expect(h.document.nodes).toEqual(start.nodes)
        expect(h.document.rootIds).toEqual(start.rootIds)
        expect(h.document.childIds).toEqual(start.childIds)
      }),
      { numRuns: 300 },
    )
  })

  it('redoing everything after undoing everything returns to the end state', () => {
    const names = ['a', 'b', 'c']

    fc.assert(
      fc.property(fc.array(arbAction(names), { maxLength: 10 }), (actions) => {
        let h = createHistory(withNodes(...names), { ...DEFAULT_HISTORY_CONFIG, coalesceWindowMs: 0 })

        for (const [i, action] of actions.entries()) {
          // Same exemption as above: an insertion's target is by definition absent, so the
          // guard would skip every one of them and this test would still be fuzzing three
          // action types while appearing to fuzz four.
          if (action.type === 'InsertNode') {
            if (h.document.nodes[action.node.id] !== undefined) continue
          } else if (targetsOf(action).some((t) => h.document.nodes[t] === undefined)) continue
          h = push(h, action, opts('a', 1000 + i * 10_000))
        }

        const end = h.document
        while (canUndo(h)) h = undo(h)
        while (canRedo(h)) h = redo(h)

        expect(h.document.nodes).toEqual(end.nodes)
        expect(h.document.rootIds).toEqual(end.rootIds)
      }),
      { numRuns: 300 },
    )
  })
})

describe('batches', () => {
  const move = (name: string, x: number): EditorAction => ({
    type: 'SetProperty',
    nodeId: id(name),
    key: 'x',
    value: x,
  })

  it('records several actions as ONE entry', () => {
    /**
     * The problem the Report Builder proved: aligning six tiles is one thing the user did, and
     * `push` per tile produced twelve entries — so a single undo left five of them moved.
     */
    let h = createHistory(withNodes('a', 'b', 'c'), DEFAULT_HISTORY_CONFIG)
    h = pushBatch(h, [move('a', 10), move('b', 10), move('c', 10)], opts('align', 1000))

    expect(h.entries).toHaveLength(1)
    expect(h.document.nodes[id('a')]?.props['x']).toBe(10)
    expect(h.document.nodes[id('c')]?.props['x']).toBe(10)
  })

  it('one undo reverses the whole batch', () => {
    let h = createHistory(withNodes('a', 'b', 'c'), DEFAULT_HISTORY_CONFIG)
    h = push(h, move('a', 1), opts('first', 1000))
    h = pushBatch(h, [move('a', 10), move('b', 10), move('c', 10)], opts('align', 20_000))

    h = undo(h)

    // Back to the state before the batch, not before the batch's first action.
    expect(h.document.nodes[id('a')]?.props['x']).toBe(1)
    expect(h.document.nodes[id('b')]?.props['x']).toBeUndefined()
    expect(h.document.nodes[id('c')]?.props['x']).toBeUndefined()
    expect(canUndo(h)).toBe(true)
  })

  it('unwinds in reverse, so two writes to ONE node restore the original', () => {
    /**
     * The ordering bug this is built to avoid. Inverses are computed against the document before
     * each action and PREPENDED, so undo applies the last action's inverse first. Appending them
     * instead restores the intermediate value — the same mistake coalescing had to avoid, and
     * invisible unless a batch touches the same node twice.
     */
    let h = createHistory(withNodes('a'), DEFAULT_HISTORY_CONFIG)
    h = push(h, move('a', 0), opts('set', 1000))
    h = pushBatch(h, [move('a', 5), move('a', 9)], opts('batch', 20_000))

    expect(h.document.nodes[id('a')]?.props['x']).toBe(9)
    h = undo(h)
    expect(h.document.nodes[id('a')]?.props['x']).toBe(0)
  })

  it('redo replays the batch in order', () => {
    let h = createHistory(withNodes('a', 'b'), DEFAULT_HISTORY_CONFIG)
    h = pushBatch(h, [move('a', 10), move('b', 20)], opts('align', 1000))
    h = undo(h)
    h = redo(h)

    expect(h.document.nodes[id('a')]?.props['x']).toBe(10)
    expect(h.document.nodes[id('b')]?.props['x']).toBe(20)
  })

  it('never coalesces into the entry before it', () => {
    // A batch is a deliberate unit. Merging it into whatever came before would make one undo
    // reverse a command and an unrelated edit together.
    let h = createHistory(withNodes('a'), DEFAULT_HISTORY_CONFIG)
    h = push(h, move('a', 1), opts('typing', 1000))
    h = pushBatch(h, [move('a', 2), move('a', 3)], opts('align', 1010))

    expect(h.entries).toHaveLength(2)
  })

  it('an empty batch is a no-op rather than an empty entry', () => {
    // An entry with no actions is indistinguishable from a commit boundary, and it would make
    // undo appear to do nothing.
    const start = createHistory(withNodes('a'), DEFAULT_HISTORY_CONFIG)
    expect(pushBatch(start, [], opts('nothing', 1000))).toBe(start)
  })

  it('a single-action batch behaves exactly like push, coalescing included', () => {
    // Otherwise a caller that batched by habit would silently lose coalescing, and typing routed
    // through it would produce one entry per keystroke.
    let h = createHistory(withNodes('a'), DEFAULT_HISTORY_CONFIG)
    h = pushBatch(h, [move('a', 1)], opts('e', 1000))
    h = pushBatch(h, [move('a', 2)], opts('e', 1100))

    expect(h.entries).toHaveLength(1)
  })

  it('restores the starting document for any batch, under fuzzing', () => {
    const names = ['a', 'b', 'c']

    fc.assert(
      fc.property(fc.array(arbBatchAction(names), { minLength: 1, maxLength: 8 }), (actions) => {
        const start = withNodes(...names)
        let h = createHistory(start, DEFAULT_HISTORY_CONFIG)
        h = pushBatch(h, actions, opts('batch', 1000))
        h = undo(h)

        expect(h.document.nodes).toEqual(start.nodes)
        expect(h.document.rootIds).toEqual(start.rootIds)
        expect(h.document.childIds).toEqual(start.childIds)
      }),
      { numRuns: 300 },
    )
  })
})

/**
 * Property-test actions for a batch.
 *
 * Restricted to `SetProperty` and `MoveNodes` — the two a real batch command issues. Insertion
 * and removal within one batch are not something any command does, and generating them would
 * test a combination no caller can produce.
 */
const arbBatchAction = (names: readonly string[]): fc.Arbitrary<EditorAction> =>
  fc.oneof(
    fc.record({
      type: fc.constant('SetProperty' as const),
      nodeId: fc.constantFrom(...names).map(id),
      key: fc.constantFrom('x', 'y'),
      value: fc.integer({ min: -100, max: 100 }),
    }),
    fc.record({
      type: fc.constant('MoveNodes' as const),
      nodeIds: fc.constantFrom(...names).map((n) => [id(n)]),
      toParentId: fc.constant(null),
      toIndex: fc.integer({ min: 0, max: 2 }),
    }),
  )
