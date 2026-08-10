import { describe, expect, it } from 'vitest'
import { ContractViolationError } from '../http/errors'
import { nutritionPlanBodyFrom, nutritionPlanFrom } from './nutrition'

const ID = (n: number) => `018f2c8a-0000-7000-8000-00000000000${String(n)}`

const wire = () => ({
  id: ID(1),
  title: 'Base',
  meals: [
    {
      id: ID(3),
      name: 'Lunch',
      when: 'midday',
      order: 1,
      items: [
        { id: ID(5), food: 'Rice', amount: '150 g', order: 1 },
        { id: ID(4), food: 'Chicken', amount: '200 g', order: 0 },
      ],
    },
    { id: ID(2), name: 'Breakfast', when: 'on waking', order: 0, items: [] },
  ],
})

describe('reading a plan', () => {
  it('sorts at BOTH levels', () => {
    /**
     * The contract promises no order at either level, and this is the first nested shape in the
     * layer. A plan whose meals arrived unsorted renders as a different day's eating; items
     * unsorted within a meal is the same defect one level down, and easier to miss.
     */
    const plan = nutritionPlanFrom(wire())

    expect(plan.meals.map((m) => m.name)).toEqual(['Breakfast', 'Lunch'])
    expect(plan.meals[1]?.items.map((i) => i.food)).toEqual(['Chicken', 'Rice'])
  })

  it('keeps a meal with no items as a meal', () => {
    // A coach adds the meal, then fills it in. Dropping empty ones would delete their work.
    expect(nutritionPlanFrom(wire()).meals[0]?.items).toEqual([])
  })

  it('rejects a response that does not match the contract', () => {
    const bad = { ...wire(), meals: [{ ...wire().meals[1], name: '' }] }
    expect(() => nutritionPlanFrom(bad)).toThrow(ContractViolationError)
  })

  it('rejects an item whose amount is empty rather than rendering a blank', () => {
    // '' would reach the screen as a food with no quantity — which reads as an instruction.
    const w = wire()
    w.meals[0]!.items[0]!.amount = ''
    expect(() => nutritionPlanFrom(w)).toThrow(ContractViolationError)
  })
})

describe('writing a plan', () => {
  it('round-trips', () => {
    const plan = nutritionPlanFrom(wire())
    expect(nutritionPlanFrom(nutritionPlanBodyFrom(plan))).toEqual(plan)
  })

  it('validates on the way OUT too, so a client bug is not sent to the server', () => {
    const plan = nutritionPlanFrom(wire())
    const broken = { ...plan, meals: [] }
    // `minItems: 1` — a plan with no meals is not a plan, and the strict-writer half of ADR-0031
    // is what stops the client discovering that from a 400.
    expect(() => nutritionPlanBodyFrom(broken)).toThrow(ContractViolationError)
  })
})
