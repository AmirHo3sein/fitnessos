import { isErr, isOk } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { itemCount, nutritionPlan, type Item, type Meal, type NutritionPlanInput } from './NutritionPlan'

const item = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  food: 'Oats',
  amount: '80 g',
  order: 0,
  ...over,
})

const meal = (over: Partial<Meal> = {}): Meal => ({
  id: 'm1',
  name: 'Breakfast',
  when: 'on waking',
  items: [item()],
  order: 0,
  ...over,
})

const input = (meals: Meal[]): NutritionPlanInput => ({ id: 'n1', title: 'Base', meals })

describe('a valid plan', () => {
  it('is constructed from meals with items', () => {
    expect(isOk(nutritionPlan(input([meal()])))).toBe(true)
  })

  it('sorts meals and their items, and freezes both', () => {
    const result = nutritionPlan(
      input([
        meal({
          id: 'later',
          order: 1,
          items: [item({ id: 'b', order: 1 }), item({ id: 'a', order: 0 })],
        }),
        meal({ id: 'first', order: 0 }),
      ]),
    )
    expect(isOk(result) && result.value.meals.map((m) => m.id)).toEqual(['first', 'later'])
    expect(isOk(result) && result.value.meals[1]?.items.map((i) => i.id)).toEqual(['a', 'b'])
    // Frozen, so the immutability claim is true at runtime and not only in the types — `readonly`
    // is erased at compile time and stops nothing.
    expect(isOk(result) && Object.isFrozen(result.value.meals)).toBe(true)
  })

  it('allows a meal with no items', () => {
    // A coach adding a meal and filling it in later is the normal way this gets authored. Refusing
    // would mean the builder could not create one.
    expect(isOk(nutritionPlan(input([meal({ items: [] })])))).toBe(true)
  })

  it('accepts an amount in whatever form a coach writes it', () => {
    // Free text on purpose: totalling nutrients needs a food catalogue, and ADR-0012 makes
    // catalogue versioning a prerequisite that is still pending.
    for (const amount of ['200 g', '1 cup', 'a handful', '۲ قاشق']) {
      expect(isOk(nutritionPlan(input([meal({ items: [item({ amount })] })])))).toBe(true)
    }
  })
})

describe('what it refuses', () => {
  const rejects = (meals: Meal[], kind: string) => {
    const result = nutritionPlan(input(meals))
    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.kind).toBe(kind)
  }

  it('refuses a plan with no meals', () => {
    // The state a half-finished builder session would save, which every consumer downstream would
    // then have to special-case.
    rejects([], 'no-meals')
  })

  it('refuses an item with no amount', () => {
    // An item with no amount is a shopping list entry, not a prescription.
    rejects([meal({ items: [item({ amount: '  ' })] })], 'item-amount-empty')
  })

  it('refuses an item with no food and a meal with no name', () => {
    rejects([meal({ items: [item({ food: '' })] })], 'item-food-empty')
    rejects([meal({ name: ' ' })], 'meal-name-empty')
  })

  it('refuses an item id reused in ANOTHER meal', () => {
    /**
     * Uniqueness is across the whole plan, not per meal. Item ids are node ids in the editor's flat
     * record, so two items sharing one would be a single node with two parents — and moving an item
     * between meals would silently merge them.
     */
    rejects(
      [
        meal({ id: 'm1', items: [item({ id: 'shared' })] }),
        meal({ id: 'm2', order: 1, items: [item({ id: 'shared' })] }),
      ],
      'duplicate-item-id',
    )
  })

  it('catches a duplicate order at both levels', () => {
    // Deduplicated before comparing: a count against an expected size compares two numbers equal
    // by construction, which let `[0, 0]` through in `ProgramVersion` once.
    // The second meal gets its own item id: sharing the default would trip the plan-wide
    // uniqueness rule first, which is that rule working rather than this one failing.
    rejects(
      [meal({ id: 'a' }), meal({ id: 'b', order: 0, items: [item({ id: 'i2' })] })],
      'meal-order-not-contiguous',
    )
    rejects(
      [meal({ items: [item({ id: 'x', order: 0 }), item({ id: 'y', order: 0 })] })],
      'item-order-not-contiguous',
    )
  })

  it('catches a gap in item order', () => {
    rejects(
      [meal({ items: [item({ id: 'x', order: 0 }), item({ id: 'y', order: 5 })] })],
      'item-order-not-contiguous',
    )
  })
})

describe('what is derived', () => {
  it('counts items across every meal', () => {
    // Derived rather than stored: a count on the aggregate is a second source of truth that drifts
    // the first time an item is added without it being updated.
    const result = nutritionPlan(
      input([
        meal({ items: [item({ id: 'a' }), item({ id: 'b', order: 1 })] }),
        meal({ id: 'm2', order: 1, items: [item({ id: 'c' })] }),
      ]),
    )
    expect(isOk(result) && itemCount(result.value)).toBe(3)
    expect(isOk(result) && result.value).not.toHaveProperty('itemCount')
  })
})
