import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { NutritionSnapshot } from '../../editor/schema'
import { NutritionBuilder, type NutritionBuilderLabels } from './NutritionBuilder'

const LABELS: NutritionBuilderLabels = {
  heading: 'Meals',
  addMeal: 'Add meal',
  removeMeal: 'Remove meal',
  addItem: 'Add item',
  removeItem: 'Remove item',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save',
  mealName: 'Meal',
  mealWhen: 'When',
  food: 'Food',
  amount: 'Amount',
  moveTo: 'In meal',
  newMealName: 'New meal',
  newFood: 'Food',
  newAmount: '100 g',
  empty: 'This plan has no meals yet.',
  noItems: 'Nothing in this meal yet.',
}

const plan = (): NutritionSnapshot => ({
  id: 'n1',
  title: 'Base',
  meals: [
    {
      id: 'm1',
      name: 'Breakfast',
      when: 'on waking',
      order: 0,
      items: [
        { id: 'm1i0', food: 'Oats', amount: '80 g', order: 0 },
        { id: 'm1i1', food: 'Milk', amount: '300 ml', order: 1 },
      ],
    },
    { id: 'm2', name: 'Lunch', when: 'midday', order: 1, items: [] },
  ],
})

type SaveFn = (p: NutritionSnapshot) => boolean | Promise<boolean>

const mount = (onSave: Mock<SaveFn> = vi.fn<SaveFn>(() => true)) => {
  render(<NutritionBuilder plan={plan()} locale="en" labels={LABELS} onSave={onSave} />)
  return onSave
}

describe('rendering two levels', () => {
  it('renders items under their meal, not beside it', () => {
    mount()
    expect(screen.getAllByLabelText('Meal')).toHaveLength(2)
    expect(screen.getAllByLabelText('Food')).toHaveLength(2)
    expect(screen.getAllByLabelText('Food')[0]).toHaveValue('Oats')
  })

  it('explains a meal with nothing in it', () => {
    // A coach adds a meal and fills it in later; an empty row with no words reads as broken.
    mount()
    expect(screen.getByText('Nothing in this meal yet.')).toBeInTheDocument()
  })
})

describe('editing at both levels', () => {
  it('renames a meal', async () => {
    const onSave = mount()
    const name = screen.getAllByLabelText('Meal')[0]!
    await userEvent.clear(name)
    await userEvent.type(name, 'Pre-training')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![0].meals[0]?.name).toBe('Pre-training')
  })

  it('adds an item to the right meal, not to the root', async () => {
    // Inserting at the root would produce a nameless extra meal beside one missing its item.
    const onSave = mount()
    await userEvent.click(screen.getAllByRole('button', { name: 'Add item' })[1]!)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.meals).toHaveLength(2)
    expect(saved.meals[1]?.items).toHaveLength(1)
    expect(saved.meals[1]?.items[0]?.food).toBe('Food')
  })

  it('derives item order from position, at the nested level too', async () => {
    const onSave = mount()
    await userEvent.click(screen.getAllByRole('button', { name: 'Add item' })[0]!)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![0].meals[0]?.items.map((i) => i.order)).toEqual([0, 1, 2])
  })
})

describe('removing a meal takes its items, and undo gives them back', () => {
  it('removes the subtree in one action', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove meal Breakfast' }))

    expect(screen.getAllByLabelText('Meal')).toHaveLength(1)
    expect(screen.queryAllByLabelText('Food')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0]![0].meals).toHaveLength(1)
  })

  it('ONE undo restores the meal and everything in it', async () => {
    /**
     * `InsertSubtree` doing the work. The component tracks nothing: the engine captured the items
     * into the inverse at the moment of removal, which is the only moment they still existed.
     */
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove meal Breakfast' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(screen.getAllByLabelText('Meal')[0]).toHaveValue('Breakfast')
    expect(screen.getAllByLabelText('Food').map((el) => (el as HTMLInputElement).value)).toEqual([
      'Oats',
      'Milk',
    ])
  })
})

describe('moving an item between meals', () => {
  it('re-parents it and appends it to the target', async () => {
    // `MoveNodes` with a new parent — a path that existed in the engine with no consumer until
    // now. Moving a shake from breakfast to post-training is a gesture a coach actually makes.
    const onSave = mount()
    await userEvent.selectOptions(screen.getAllByLabelText('In meal')[0]!, 'm2')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.meals[0]?.items.map((i) => i.food)).toEqual(['Milk'])
    expect(saved.meals[1]?.items.map((i) => i.food)).toEqual(['Oats'])
    // Renumbered by position at both levels, so no gap is left behind.
    expect(saved.meals[0]?.items.map((i) => i.order)).toEqual([0])
    expect(saved.meals[1]?.items.map((i) => i.order)).toEqual([0])
  })

  it('undo puts it back in its original meal', async () => {
    mount()
    await userEvent.selectOptions(screen.getAllByLabelText('In meal')[0]!, 'm2')
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

    // Back under Breakfast, and first — `RestorePositions` carries the index, not just the parent.
    expect(screen.getAllByLabelText('Food').map((el) => (el as HTMLInputElement).value)).toEqual([
      'Oats',
      'Milk',
    ])
  })
})

describe('the commit boundary', () => {
  it('moves only when the save landed', async () => {
    mount(vi.fn<SaveFn>(() => false))
    await userEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })
})
