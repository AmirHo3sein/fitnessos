'use client'

import { Button, Card } from '@fitnessos/ui'
import { newEntityId, type Locale } from '@fitnessos/kernel'
import { childrenOf, type NodeId } from '@fitnessos/editor-engine'
import {
  EditorStoreProvider,
  createEditorStore,
  useChildIds,
  useEditorStore,
  useHistoryControls,
  useNode,
} from '@fitnessos/editor-react'
import { useMemo, useState } from 'react'
import {
  ITEM_NODE,
  MEAL_NODE,
  commit,
  hydrate,
  type NutritionSnapshot,
} from '../../editor/schema'

export interface NutritionBuilderLabels {
  readonly heading: string
  readonly addMeal: string
  readonly removeMeal: string
  readonly addItem: string
  readonly removeItem: string
  readonly undo: string
  readonly redo: string
  readonly save: string
  readonly mealName: string
  readonly mealWhen: string
  readonly food: string
  readonly amount: string
  readonly moveTo: string
  readonly newMealName: string
  readonly newFood: string
  readonly newAmount: string
  readonly empty: string
  readonly noItems: string
}

export interface NutritionBuilderProps {
  plan: NutritionSnapshot
  locale: Locale
  labels: NutritionBuilderLabels
  onSave: (plan: NutritionSnapshot) => boolean | Promise<boolean>
  isSaving?: boolean
}

/**
 * The Nutrition Builder — the first UI over a two-level document.
 *
 * Every builder before this rendered one list. Here a meal renders a list of items, and the
 * operations come in pairs: add a meal, add an item; remove a meal, remove an item. Removing a
 * meal takes its items with it and undo gives them back, which is the engine's `InsertSubtree`
 * doing the work rather than this component tracking anything.
 *
 * It also has the first re-parenting control in the codebase: an item's "move to" select dispatches
 * `MoveNodes` with a new `toParentId`. That path existed in the engine and had no consumer until
 * now — and it is a genuinely useful gesture here, because moving a shake from breakfast to
 * post-training is a thing a coach actually does.
 */
export const NutritionBuilder = ({
  plan,
  locale,
  labels,
  onSave,
  isSaving = false,
}: NutritionBuilderProps) => {
  const store = useMemo(() => {
    const draft = hydrate(plan)
    return { editor: createEditorStore({ document: draft.document }), preserved: draft.preserved }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on identity, see the other builders
  }, [plan.id])

  return (
    <EditorStoreProvider value={store.editor}>
      <BuilderShell
        locale={locale}
        labels={labels}
        isSaving={isSaving}
        onSave={async () => {
          const state = store.editor.getState()
          const persisted = await onSave(
            commit({ document: state.document, preserved: store.preserved }),
          )
          if (persisted) store.editor.commit()
        }}
      />
    </EditorStoreProvider>
  )
}

const BuilderShell = ({
  locale,
  labels,
  isSaving,
  onSave,
}: {
  locale: Locale
  labels: NutritionBuilderLabels
  isSaving: boolean
  onSave: () => Promise<void>
}) => {
  const store = useEditorStore()
  const mealIds = useChildIds(null)
  const history = useHistoryControls()

  const addMeal = () => {
    const id = newEntityId() as NodeId
    store.dispatch(
      {
        type: 'InsertNode',
        node: { id, type: MEAL_NODE, props: { name: labels.newMealName, when: '' } },
        parentId: null,
        index: mealIds.length,
      },
      { label: 'add meal' },
    )
    store.setEphemeral({ selected: [id] })
  }

  return (
    <div className="space-y-4">
      {/* Heading on its own row — five controls and a heading do not share a line on a phone. */}
      <h2 className="text-display text-xl">{labels.heading}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" isDisabled={!history.canUndo} onPress={history.undo}>
          {labels.undo}
        </Button>
        <Button type="button" variant="secondary" size="sm" isDisabled={!history.canRedo} onPress={history.redo}>
          {labels.redo}
        </Button>
        <Button type="button" variant="secondary" size="sm" onPress={addMeal}>
          {labels.addMeal}
        </Button>
        <Button type="button" size="sm" isDisabled={isSaving} onPress={() => void onSave()}>
          {labels.save}
        </Button>
      </div>

      {mealIds.length === 0 ? (
        <Card>
          <p className="text-muted text-sm">{labels.empty}</p>
        </Card>
      ) : (
        <ol className="space-y-3">
          {mealIds.map((id, index) => (
            <MealRow key={id} id={id} index={index} mealIds={mealIds} locale={locale} labels={labels} />
          ))}
        </ol>
      )}
    </div>
  )
}

/** A text field bound to one node prop, coalesced into a single undo per burst of typing. */
const PropField = ({
  nodeId,
  propKey,
  label,
  value,
}: {
  nodeId: NodeId
  propKey: string
  label: string
  value: string
}) => {
  const store = useEditorStore()
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <div className="flex-1">
      <label className="text-muted block text-xs" htmlFor={`${nodeId}-${propKey}`}>
        {label}
      </label>
      <input
        id={`${nodeId}-${propKey}`}
        value={draft ?? value}
        onChange={(event) => {
          setDraft(event.target.value)
          store.dispatch(
            { type: 'SetProperty', nodeId, key: propKey, value: event.target.value },
            { label: `edit ${propKey}` },
          )
        }}
        onBlur={() => {
          setDraft(null)
        }}
        className="border-default bg-surface-elevated text-primary focus:border-brand-border mt-1 h-10 w-full rounded-md border px-3"
      />
    </div>
  )
}

const MealRow = ({
  id,
  index,
  mealIds,
  locale,
  labels,
}: {
  id: NodeId
  index: number
  mealIds: readonly NodeId[]
  locale: Locale
  labels: NutritionBuilderLabels
}) => {
  const store = useEditorStore()
  const node = useNode(id)
  const itemIds = useChildIds(id)

  if (node === null) return null

  const text = (key: string) => (typeof node.props[key] === 'string' ? node.props[key] : '')
  const nf = new Intl.NumberFormat(locale)

  const addItem = () => {
    const itemId = newEntityId() as NodeId
    store.dispatch(
      {
        type: 'InsertNode',
        node: {
          id: itemId,
          type: ITEM_NODE,
          props: { food: labels.newFood, amount: labels.newAmount },
        },
        // The meal, not the root. Inserting at the root would produce a meal with no name and no
        // items, beside a meal that lost the one just added.
        parentId: id,
        index: itemIds.length,
      },
      { label: 'add item' },
    )
  }

  return (
    // The id, so an end-to-end test can assert WHICH meal an item ended up under rather than
    // inferring it from ordering — the whole point of the re-parenting path.
    <li data-testid={`meal-${id}`}>
      <Card>
        <div className="flex items-start gap-2">
          <span className="text-muted nums mt-6 w-6 shrink-0 text-xs">{nf.format(index + 1)}</span>
          <PropField nodeId={id} propKey="name" label={labels.mealName} value={text('name')} />
          <PropField nodeId={id} propKey="when" label={labels.mealWhen} value={text('when')} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-6"
            aria-label={`${labels.removeMeal} ${text('name')}`}
            onPress={() => {
              // One action. The engine captures the items into the inverse, so undo restores the
              // meal AND everything in it — this component tracks nothing.
              store.dispatch({ type: 'RemoveNode', nodeId: id }, { label: 'remove meal' })
            }}
          >
            ✕
          </Button>
        </div>

        {itemIds.length === 0 ? (
          <p className="text-muted ms-8 mt-3 text-xs">{labels.noItems}</p>
        ) : (
          <ol className="ms-8 mt-3 space-y-2">
            {itemIds.map((itemId) => (
              <ItemRow
                key={itemId}
                id={itemId}
                mealId={id}
                mealIds={mealIds}
                labels={labels}
              />
            ))}
          </ol>
        )}

        <Button type="button" variant="ghost" size="sm" className="ms-8 mt-2" onPress={addItem}>
          {labels.addItem}
        </Button>
      </Card>
    </li>
  )
}

const ItemRow = ({
  id,
  mealId,
  mealIds,
  labels,
}: {
  id: NodeId
  mealId: NodeId
  mealIds: readonly NodeId[]
  labels: NutritionBuilderLabels
}) => {
  const store = useEditorStore()
  const node = useNode(id)

  if (node === null) return null

  const text = (key: string) => (typeof node.props[key] === 'string' ? node.props[key] : '')

  return (
    <li className="flex items-start gap-2" data-testid={`item-${id}`}>
      <PropField nodeId={id} propKey="food" label={labels.food} value={text('food')} />
      <PropField nodeId={id} propKey="amount" label={labels.amount} value={text('amount')} />

      {/*
        Re-parenting, and the engine's first consumer of it. `MoveNodes` with a new `toParentId`
        has existed since the engine was written; moving a shake from breakfast to post-training is
        a gesture a coach actually makes, so it earns the control rather than justifying it.
      */}
      <div className="flex-1">
        <label className="text-muted block text-xs" htmlFor={`${id}-move`}>
          {labels.moveTo}
        </label>
        <select
          id={`${id}-move`}
          value={mealId}
          onChange={(event) => {
            const target = event.target.value as NodeId
            if (target === mealId) return
            store.dispatch(
              {
                type: 'MoveNodes',
                nodeIds: [id],
                toParentId: target,
                // Appended: an item moved into a meal goes at the end, which is where a coach
                // reading the meal expects to find the thing they just moved.
                toIndex: childrenOf(store.getState().document, target).length,
              },
              { label: 'move item' },
            )
          }}
          className="border-default bg-surface-elevated text-primary focus:border-brand-border mt-1 h-10 w-full rounded-md border px-2"
        >
          {mealIds.map((other) => (
            <MealOption key={other} id={other} />
          ))}
        </select>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-6"
        aria-label={`${labels.removeItem} ${text('food')}`}
        onPress={() => {
          store.dispatch({ type: 'RemoveNode', nodeId: id }, { label: 'remove item' })
        }}
      >
        ✕
      </Button>
    </li>
  )
}

/** Its own component so the option subscribes to the meal it names, not to the whole document. */
const MealOption = ({ id }: { id: NodeId }) => {
  const node = useNode(id)
  const name = typeof node?.props['name'] === 'string' ? node.props['name'] : ''
  return <option value={id}>{name}</option>
}
