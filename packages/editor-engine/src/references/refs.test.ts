import { describe, expect, it } from 'vitest'
import { applyAction } from '../document/actions'
import { emptyDocument, type DocumentSnapshot, type NodeId } from '../document/snapshot'
import { isDocumentRef, refKey, refsIn, remapIds, type DocumentRef } from './refs'

const id = (n: string) => n as NodeId

const goalRef = (goalId: string, label = 'Run 10k'): DocumentRef => ({
  kind: 'goal',
  id: goalId,
  fallbackLabel: label,
})

const docWith = (props: Record<string, Record<string, unknown>>): DocumentSnapshot => {
  let doc = emptyDocument('test')
  for (const [name, p] of Object.entries(props)) {
    doc = applyAction(doc, {
      type: 'InsertNode',
      node: { id: id(name), type: 'block', props: p },
      parentId: null,
      index: 0,
    })
  }
  return doc
}

describe('recognising a reference', () => {
  it('accepts a well-formed one', () => {
    expect(isDocumentRef(goalRef('g1'))).toBe(true)
  })

  it('rejects an unknown kind', () => {
    // Kinds are closed because each needs its own resolver. An unrecognised kind must not be
    // collected and then silently fail to resolve.
    expect(isDocumentRef({ kind: 'planet', id: 'g1', fallbackLabel: 'x' })).toBe(false)
  })

  it('rejects a value missing its fallback label', () => {
    // The fallback is not optional decoration — it is the only renderable content when the
    // target is gone. A ref without one is a ref that renders as nothing.
    expect(isDocumentRef({ kind: 'goal', id: 'g1' })).toBe(false)
  })

  it('rejects null and primitives without throwing', () => {
    for (const value of [null, undefined, 0, '', 'goal:g1', []]) {
      expect(isDocumentRef(value)).toBe(false)
    }
  })
})

describe('collecting references', () => {
  it('finds refs in any prop, whatever the key is called', () => {
    // The engine does not know a builder's schema, so it cannot look in a named field.
    const doc = docWith({ a: { servesGoal: goalRef('g1'), name: 'Prep' } })
    expect(refsIn(doc)).toEqual([goalRef('g1')])
  })

  it('deduplicates the same target across nodes', () => {
    // A resolver call is a network request. Twelve blocks serving one goal must ask once.
    const doc = docWith({
      a: { servesGoal: goalRef('g1') },
      b: { servesGoal: goalRef('g1') },
      c: { servesGoal: goalRef('g2') },
    })
    expect(refsIn(doc).map((r) => r.id)).toEqual(['g1', 'g2'])
  })

  it('does not conflate the same id across kinds', () => {
    // Ids are unique per kind, not globally. Keying on the id alone would resolve a movement as
    // a goal, or drop one of the two entirely.
    const doc = docWith({
      a: { ref: { kind: 'goal', id: 'x', fallbackLabel: 'G' } },
      b: { ref: { kind: 'movement', id: 'x', fallbackLabel: 'M' } },
    })
    expect(refsIn(doc)).toHaveLength(2)
    expect(refKey({ kind: 'goal', id: 'x', fallbackLabel: 'G' })).toBe('goal:x')
  })

  it('returns nothing for a document with no references', () => {
    expect(refsIn(docWith({ a: { name: 'Prep' } }))).toEqual([])
  })
})

describe('remapIds — the paste path', () => {
  const original = () => {
    let doc = emptyDocument('test')
    doc = applyAction(doc, {
      type: 'InsertNode',
      node: { id: id('parent'), type: 'block', props: { servesGoal: goalRef('g1') } },
      parentId: null,
      index: 0,
    })
    doc = applyAction(doc, {
      type: 'InsertNode',
      node: { id: id('child'), type: 'item', props: { name: 'Squat' } },
      parentId: id('parent'),
      index: 0,
    })
    return doc
  }

  const MAP = new Map<NodeId, NodeId>([
    [id('parent'), id('parent-2')],
    [id('child'), id('child-2')],
  ])

  it('rewrites node keys, node ids, childIds and rootIds together', () => {
    // Missing any one of the four leaves a document that looks right and has a dangling edge.
    const pasted = remapIds(original(), MAP)

    expect(Object.keys(pasted.nodes).sort()).toEqual(['child-2', 'parent-2'])
    expect(pasted.nodes[id('parent-2')]?.id).toBe('parent-2')
    expect(pasted.rootIds).toEqual([id('parent-2')])
    expect(pasted.childIds[id('parent-2')]).toEqual([id('child-2')])
  })

  it('leaves a DocumentRef completely unchanged', () => {
    /**
     * The bug this exists to prevent. A ref LOOKS like an id and is not one — it points outside
     * the document, at something the paste did not copy. Remapping it would repoint a pasted
     * block at a goal that does not exist, producing a broken reference in a document nobody
     * edited by hand.
     */
    const withRefInMap = new Map(MAP)
    withRefInMap.set('g1' as NodeId, 'g1-remapped' as NodeId)

    const pasted = remapIds(original(), withRefInMap)

    expect(pasted.nodes[id('parent-2')]?.props['servesGoal']).toEqual(goalRef('g1'))
  })

  it('leaves ids absent from the map alone', () => {
    // Pasting a subtree remaps that subtree. Nodes already in the target document keep their ids.
    const pasted = remapIds(original(), new Map([[id('child'), id('child-2')]]))
    expect(pasted.rootIds).toEqual([id('parent')])
    expect(pasted.childIds[id('parent')]).toEqual([id('child-2')])
  })

  it('does not mutate the source document', () => {
    // Pasting must not disturb what was copied — the clipboard survives more than one paste.
    const source = original()
    remapIds(source, MAP)
    expect(source.rootIds).toEqual([id('parent')])
    expect(source.nodes[id('parent')]).toBeDefined()
  })

  it('a remapped document still yields the same references', () => {
    expect(refsIn(remapIds(original(), MAP))).toEqual([goalRef('g1')])
  })
})
