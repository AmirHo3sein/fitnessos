import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isOk } from '@fitnessos/kernel'
import {
  DEFAULT_HISTORY_CONFIG,
  applyAction,
  childrenOf,
  createHistory,
  descendantsOf,
  invertAction,
  push,
  undo,
  type NodeId,
} from '@fitnessos/editor-engine'
import { nutritionPlan, type Meal } from '../domain/NutritionPlan'
import { HYDRATE_COVERAGE, commit, hydrate, normalize, type NutritionSnapshot } from './schema'

const arbText = fc.string({ minLength: 1 }).filter((s) => s.trim() !== '')

const arbPlan: fc.Arbitrary<NutritionSnapshot> = fc
  .array(
    fc.record({
      name: arbText,
      when: fc.string(),
      items: fc.array(fc.record({ food: arbText, amount: arbText }), { maxLength: 4 }),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .chain((meals) =>
    fc.record({
      id: fc.constant('n1'),
      title: arbText,
      meals: fc.constant(
        meals.map((meal, m) => ({
          id: `m${String(m)}`,
          name: meal.name,
          when: meal.when,
          order: m,
          items: meal.items.map((item, i) => ({
            // Unique across the WHOLE plan: item ids are node ids in a flat record, so two items
            // sharing one would be a single node with two parents.
            id: `m${String(m)}i${String(i)}`,
            food: item.food,
            amount: item.amount,
            order: i,
          })),
        })),
      ),
    }),
  )

const meal = (over: Partial<Meal> = {}): Meal => ({
  id: 'm1',
  name: 'Breakfast',
  when: 'on waking',
  order: 0,
  items: [
    { id: 'm1i0', food: 'Oats', amount: '80 g', order: 0 },
    { id: 'm1i1', food: 'Milk', amount: '300 ml', order: 1 },
  ],
  ...over,
})

const snapshot = (meals: Meal[]): NutritionSnapshot => ({ id: 'n1', title: 'Base', meals })

describe('the round trip, through a NESTED document', () => {
  it('commit(hydrate(x)) preserves the plan at both levels', () => {
    fc.assert(
      fc.property(arbPlan, (p) => {
        expect(normalize(commit(hydrate(p)))).toEqual(normalize(p))
      }),
      { numRuns: 200 },
    )
  })

  it('produces a plan the domain accepts', () => {
    fc.assert(
      fc.property(arbPlan, (p) => {
        expect(isOk(nutritionPlan(commit(hydrate(p))))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('derives contiguous orders at both levels, whatever arrived', () => {
    const scattered = snapshot([
      meal({
        id: 'later',
        order: 9,
        items: [{ id: 'a', food: 'X', amount: '1', order: 7 }],
      }),
      meal({ id: 'first', order: 2 }),
    ])
    const committed = commit(hydrate(scattered))

    expect(committed.meals.map((m) => m.order)).toEqual([0, 1])
    expect(committed.meals.map((m) => m.id)).toEqual(['first', 'later'])
    expect(committed.meals[1]?.items[0]?.order).toBe(0)
  })

  it('puts items under their meal in childIds, not at the root', () => {
    // The whole difference from the flat editors. Items at the root would commit as meals with no
    // items and two extra empty meals.
    const draft = hydrate(snapshot([meal()]))
    expect(draft.document.rootIds).toEqual(['m1'])
    expect(childrenOf(draft.document, 'm1' as NodeId)).toEqual(['m1i0', 'm1i1'])
  })

  it('accounts for every field of the snapshot', () => {
    expect(Object.keys(HYDRATE_COVERAGE).sort()).toEqual(['id', 'meals', 'title'])
  })
})

describe('removing a meal takes its items and gives them back', () => {
  it('captures the whole subtree in the inverse', () => {
    /**
     * `InsertSubtree` has existed since the engine was written and until now had no consumer
     * outside its own unit tests, because every builder was flat. This is the case it was built
     * for: the inverse of removing a meal has to carry the items, since by the time undo runs they
     * are gone and there is nothing left to recompute from.
     */
    const draft = hydrate(snapshot([meal(), meal({ id: 'm2', order: 1, items: [] })]))
    const inverse = invertAction(draft.document, { type: 'RemoveNode', nodeId: 'm1' as NodeId })

    expect(inverse.type).toBe('InsertSubtree')
    expect(inverse.type === 'InsertSubtree' && inverse.nodes.map((n) => n.id).sort()).toEqual([
      'm1',
      'm1i0',
      'm1i1',
    ])
  })

  it('removes the items along with the meal', () => {
    const draft = hydrate(snapshot([meal()]))
    expect(descendantsOf(draft.document, 'm1' as NodeId)).toHaveLength(2)

    const after = applyAction(draft.document, { type: 'RemoveNode', nodeId: 'm1' as NodeId })
    expect(after.nodes['m1i0' as NodeId]).toBeUndefined()
    expect(after.rootIds).toEqual([])
  })

  it('undo restores the meal AND its items, in order', () => {
    const draft = hydrate(snapshot([meal(), meal({ id: 'm2', order: 1, items: [] })]))
    let history = createHistory(draft.document, DEFAULT_HISTORY_CONFIG)
    history = push(
      history,
      { type: 'RemoveNode', nodeId: 'm1' as NodeId },
      { label: 'remove meal', at: 1000, id: 'e1' },
    )
    history = undo(history)

    const restored = commit({ document: history.document, preserved: draft.preserved })
    expect(restored.meals.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(restored.meals[0]?.items.map((i) => i.food)).toEqual(['Oats', 'Milk'])
  })
})
