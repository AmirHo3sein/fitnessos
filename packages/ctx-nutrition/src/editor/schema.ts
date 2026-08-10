import {
  childrenOf,
  emptyDocument,
  type DocumentSnapshot,
  type Node,
  type NodeId,
} from '@fitnessos/editor-engine'
import type { Item, Meal } from '../domain/NutritionPlan'

/**
 * The Nutrition Builder's document schema (handbook D-09).
 *
 * The sixth editor, and the first with a genuinely NESTED document. A programme's blocks and a
 * form's fields are flat — `rootIds` and nothing else. Here a meal has items, so `childIds` finally
 * carries something.
 *
 * That matters more than it sounds. `childIds`, `parentOf`, `descendantsOf` and — above all —
 * `RemoveNode`'s subtree capture into `InsertSubtree` have existed since the engine was written and
 * have only ever been exercised by unit tests. Removing a meal here must restore its items on undo,
 * and that is precisely what `InsertSubtree` was built for.
 *
 * ## Order at two levels, derived at both
 *
 * A meal's order is its position in `rootIds`; an item's is its position in that meal's `childIds`.
 * Neither is stored as a prop, for the same reason a block's order is not: one fact, one home.
 */

export const NUTRITION_SCHEMA_ID = 'nutrition-plan'
export const NUTRITION_SCHEMA_VERSION = 1

export const MEAL_NODE = 'meal'
export const ITEM_NODE = 'item'

export interface PreservedNutritionFields {
  readonly id: string
  readonly title: string
}

export interface NutritionSnapshot {
  readonly id: string
  readonly title: string
  readonly meals: readonly Meal[]
}

export interface NutritionDraft {
  readonly document: DocumentSnapshot
  readonly preserved: PreservedNutritionFields
}

export const HYDRATE_COVERAGE: Record<keyof NutritionSnapshot, 'document' | 'preserved'> = {
  meals: 'document',
  id: 'preserved',
  title: 'preserved',
}

const str = (props: Readonly<Record<string, unknown>>, key: string): string =>
  typeof props[key] === 'string' ? props[key] : ''

export const hydrate = (snapshot: NutritionSnapshot): NutritionDraft => {
  const document = emptyDocument(NUTRITION_SCHEMA_ID, NUTRITION_SCHEMA_VERSION)

  const nodes: Record<string, Node> = {}
  const childIds: Record<string, readonly NodeId[]> = {}
  const rootIds: NodeId[] = []

  for (const meal of [...snapshot.meals].sort((a, b) => a.order - b.order)) {
    const mealId = meal.id as NodeId
    nodes[mealId] = {
      id: mealId,
      type: MEAL_NODE,
      props: { name: meal.name, when: meal.when },
    }

    const itemIds: NodeId[] = []
    for (const item of [...meal.items].sort((a, b) => a.order - b.order)) {
      const itemId = item.id as NodeId
      nodes[itemId] = {
        id: itemId,
        type: ITEM_NODE,
        props: { food: item.food, amount: item.amount },
      }
      // A leaf still gets an entry: `childrenOf` returns `[]` for a missing key, so an absent one
      // is harmless — but an explicit empty list means `Object.keys(childIds)` matches the node
      // set, which is what makes a subtree capture's bookkeeping straightforward.
      childIds[itemId] = []
      itemIds.push(itemId)
    }

    childIds[mealId] = itemIds
    rootIds.push(mealId)
  }

  return {
    document: { ...document, nodes, childIds, rootIds },
    preserved: { id: snapshot.id, title: snapshot.title },
  }
}

export const commit = (draft: NutritionDraft): NutritionSnapshot => ({
  ...draft.preserved,
  meals: draft.document.rootIds.map((mealId, mealIndex): Meal => {
    const mealProps = draft.document.nodes[mealId]?.props ?? {}
    return {
      id: mealId,
      name: str(mealProps, 'name'),
      when: str(mealProps, 'when'),
      // Position IS the order, at both levels — so the "orders are exactly 0..n-1" invariant
      // cannot be violated by the editor, and nothing ever renumbers.
      items: childrenOf(draft.document, mealId).map((itemId, itemIndex): Item => {
        const props = draft.document.nodes[itemId]?.props ?? {}
        return {
          id: itemId,
          food: str(props, 'food'),
          amount: str(props, 'amount'),
          order: itemIndex,
        }
      }),
      order: mealIndex,
    }
  }),
})

/**
 * Strip what a round trip is not required to preserve: `order`, at both levels.
 *
 * Derived on commit, so a snapshot whose meals arrived with orders 5, 9, 12 legitimately commits as
 * 0, 1, 2 — and the same for the items inside each one.
 */
export const normalize = (snapshot: NutritionSnapshot): NutritionSnapshot => ({
  ...snapshot,
  meals: [...snapshot.meals]
    .sort((a, b) => a.order - b.order)
    .map((meal, mealIndex) => ({
      ...meal,
      order: mealIndex,
      items: [...meal.items]
        .sort((a, b) => a.order - b.order)
        .map((item, itemIndex) => ({ ...item, order: itemIndex })),
    })),
})
