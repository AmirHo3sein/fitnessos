import { err, ok, type Result } from '@fitnessos/kernel'

/**
 * `NutritionPlan` — meals, and what is in them.
 *
 * The first aggregate in this codebase that is genuinely two levels deep. A programme's blocks and
 * a form's fields are flat lists; a meal CONTAINS items, and that containment is the thing being
 * authored.
 *
 * ## What this deliberately does not do
 *
 * It does not compute nutrients. An item names a food and an amount, and stops there.
 *
 * Totalling protein or energy requires a food catalogue, and ADR-0012 is explicit that catalogue
 * versioning is a prerequisite for historical display fidelity — it is still pending. Without it,
 * a plan authored today would silently change meaning when a catalogue entry was corrected: the
 * same plan, the same foods, different numbers, with nothing recording which version produced
 * which total. A structure that is honest about being a structure is worth more than a total that
 * quietly rewrites itself.
 *
 * So the unit is free text. `"200 g"`, `"1 cup"`, `"a handful"` — whatever a coach would write for
 * an athlete to read. Constraining it to a catalogue's units would be pretending the catalogue
 * exists.
 */

const brand = Symbol('NutritionPlan')

export interface Item {
  readonly id: string
  /** The food, in the coach's words. Not a catalogue reference — see the note above. */
  readonly food: string
  /** How much. Free text on purpose: `"200 g"`, `"1 cup"`, `"a handful"`. */
  readonly amount: string
  readonly order: number
}

export interface Meal {
  readonly id: string
  readonly name: string
  /**
   * When, as free text rather than a time.
   *
   * "post-training" and "before bed" are what a coach actually prescribes, and neither is a clock
   * reading. A `time` field would force one of them into the other's shape, and an athlete whose
   * session moves would have a meal at the wrong moment.
   */
  readonly when: string
  readonly items: readonly Item[]
  readonly order: number
}

export interface NutritionPlan {
  readonly [brand]: true
  readonly id: string
  readonly title: string
  readonly meals: readonly Meal[]
}

export type NutritionPlanError =
  | { readonly kind: 'title-empty' }
  | { readonly kind: 'no-meals' }
  | { readonly kind: 'duplicate-meal-id'; readonly id: string }
  | { readonly kind: 'meal-name-empty'; readonly id: string }
  | { readonly kind: 'meal-order-not-contiguous'; readonly orders: readonly number[] }
  | { readonly kind: 'duplicate-item-id'; readonly id: string }
  | { readonly kind: 'item-food-empty'; readonly id: string }
  | { readonly kind: 'item-amount-empty'; readonly id: string }
  | { readonly kind: 'item-order-not-contiguous'; readonly mealId: string; readonly orders: readonly number[] }

export interface NutritionPlanInput {
  readonly id: string
  readonly title: string
  readonly meals: readonly Meal[]
}

/**
 * Orders must be exactly 0..n-1, each once — the same invariant as a programme's blocks, and now
 * checked at TWO levels.
 *
 * Deduplicated before comparing, because comparing a count to an expected size compares two
 * numbers that are equal by construction and lets `[0, 0]` through. That mistake was made once in
 * `ProgramVersion` and is not repeated here.
 */
const ordersAreContiguous = (orders: readonly number[]): boolean => {
  const distinct = new Set(orders)
  const expected = new Set(orders.map((_, index) => index))
  return distinct.size === orders.length && orders.every((order) => expected.has(order))
}

export const nutritionPlan = (
  input: NutritionPlanInput,
): Result<NutritionPlan, NutritionPlanError> => {
  if (input.title.trim() === '') return err({ kind: 'title-empty' })
  if (input.meals.length === 0) return err({ kind: 'no-meals' })

  const mealIds = new Set<string>()
  /*
   * Item ids are unique across the WHOLE plan, not per meal.
   *
   * They are node ids in the editor document, which is a flat record — two items sharing an id
   * would be one node with two parents, and moving an item between meals would silently merge
   * them. A per-meal uniqueness rule would make that representable.
   */
  const itemIds = new Set<string>()

  for (const meal of input.meals) {
    if (mealIds.has(meal.id)) return err({ kind: 'duplicate-meal-id', id: meal.id })
    mealIds.add(meal.id)
    if (meal.name.trim() === '') return err({ kind: 'meal-name-empty', id: meal.id })

    for (const item of meal.items) {
      if (itemIds.has(item.id)) return err({ kind: 'duplicate-item-id', id: item.id })
      itemIds.add(item.id)
      if (item.food.trim() === '') return err({ kind: 'item-food-empty', id: item.id })
      if (item.amount.trim() === '') {
        // An item with no amount is not a prescription, it is a shopping list entry.
        return err({ kind: 'item-amount-empty', id: item.id })
      }
    }

    const itemOrders = meal.items.map((item) => item.order)
    if (!ordersAreContiguous(itemOrders)) {
      return err({ kind: 'item-order-not-contiguous', mealId: meal.id, orders: itemOrders })
    }
  }

  const mealOrders = input.meals.map((meal) => meal.order)
  if (!ordersAreContiguous(mealOrders)) {
    return err({ kind: 'meal-order-not-contiguous', orders: mealOrders })
  }

  return ok({
    [brand]: true,
    id: input.id,
    title: input.title.trim(),
    // Sorted at both levels, and frozen. A meal read out of sequence is a different day's eating.
    meals: Object.freeze(
      [...input.meals]
        .sort((a, b) => a.order - b.order)
        .map((meal) => ({
          ...meal,
          name: meal.name.trim(),
          items: Object.freeze([...meal.items].sort((a, b) => a.order - b.order)),
        })),
    ),
  })
}

/** How many items the plan holds. Derived, because a stored count is a second source of truth. */
export const itemCount = (plan: NutritionPlan): number =>
  plan.meals.reduce((total, meal) => total + meal.items.length, 0)
