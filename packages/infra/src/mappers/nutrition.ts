import type { Item, Meal, NutritionSnapshot } from '@fitnessos/ctx-nutrition'
import { NutritionPlanSchema, type components } from '@fitnessos/contracts'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Nutrition mappers — the only NESTED shape in this layer.
 *
 * Sorted at both levels on the way in. The contract promises no order, and a plan whose meals or
 * items arrived unsorted would render as a different day's eating.
 */
type ContractPlan = components['schemas']['NutritionPlan']
type ValidatedPlan = z.infer<typeof NutritionPlanSchema>

export const nutritionPlanFrom = (raw: unknown): NutritionSnapshot => {
  const c = parseContract(NutritionPlanSchema, raw, 'NutritionPlan')
  return {
    id: c.id,
    title: c.title,
    meals: [...c.meals]
      .sort((a, b) => a.order - b.order)
      .map(
        (m): Meal => ({
          id: m.id,
          name: m.name,
          when: m.when,
          order: m.order,
          items: [...m.items]
            .sort((a, b) => a.order - b.order)
            .map(
              (i): Item => ({ id: i.id, food: i.food, amount: i.amount, order: i.order }),
            ),
        }),
      ),
  }
}

export const nutritionPlanBodyFrom = (plan: NutritionSnapshot): ValidatedPlan => {
  const body = {
    id: plan.id,
    title: plan.title,
    meals: plan.meals.map((m) => ({
      id: m.id,
      name: m.name,
      when: m.when,
      order: m.order,
      items: m.items.map((i) => ({ id: i.id, food: i.food, amount: i.amount, order: i.order })),
    })),
  }
  return parseContract(NutritionPlanSchema, body, 'NutritionPlan (request)')
}

export const NUTRITION_PLAN_COVERAGE: Record<keyof ContractPlan, true> = {
  id: true,
  title: true,
  meals: true,
}

const _agrees: FieldsAgree<ContractPlan, ValidatedPlan> = true
void _agrees
