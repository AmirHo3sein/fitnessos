import type { Item, Loaded, Meal, NutritionSnapshot } from '@fitnessos/ctx-nutrition'
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

const planFrom = (c: ValidatedPlan): NutritionSnapshot => ({
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
          .map((i): Item => ({ id: i.id, food: i.food, amount: i.amount, order: i.order })),
      }),
    ),
})

export const nutritionPlanFrom = (raw: unknown): NutritionSnapshot =>
  planFrom(parseContract(NutritionPlanSchema, raw, 'NutritionPlan'))

/**
 * The plan, and the revision to send back when saving it (§2.1a).
 *
 * `revision` is read here and left OUT of the snapshot on purpose: the snapshot is the editor's
 * document, and a revision inside an undoable document is restored by undo — the next save then
 * answers 409 for a reason the author cannot see (ADR-0035). It travels beside the document.
 *
 * Absent means a server older than §2.1a. That becomes `null` — no base — rather than a default,
 * because any invented number would satisfy the precondition and overwrite whatever is stored.
 */
export const nutritionPlanLoadedFrom = (raw: unknown): Loaded<NutritionSnapshot> => {
  const c = parseContract(NutritionPlanSchema, raw, 'NutritionPlan')
  return { artefact: planFrom(c), revision: c.revision ?? null }
}

export const nutritionPlanBodyFrom = (
  plan: NutritionSnapshot,
  baseRevision: number | null = null,
): ValidatedPlan => {
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
    // Omitted entirely on a first save: absent means "nothing is stored yet", and a null on the
    // wire would be a claim about a revision rather than the absence of one.
    ...(baseRevision === null ? {} : { baseRevision }),
  }
  return parseContract(NutritionPlanSchema, body, 'NutritionPlan (request)')
}

export const NUTRITION_PLAN_COVERAGE: Record<keyof ContractPlan, true> = {
  id: true,
  title: true,
  meals: true,
  // Accounted for beside the document rather than in it: read into `Loaded`, sent back as
  // `baseRevision`. Covered, and deliberately absent from `NutritionSnapshot`.
  revision: true,
  baseRevision: true,
}

const _agrees: FieldsAgree<ContractPlan, ValidatedPlan> = true
void _agrees
