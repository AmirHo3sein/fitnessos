import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SubjectProvider } from '@fitnessos/ui'
import type { SubjectId } from '@fitnessos/kernel'
import { describe, expect, it, vi } from 'vitest'
import { NutritionConflictError, type Loaded, type NutritionPorts } from '../../application/index'
import type { NutritionSnapshot } from '../../editor/schema'
import { NutritionPortsProvider } from '../di'
import { NutritionWorkspace, type NutritionWorkspaceLabels } from './NutritionWorkspace'

/**
 * The conflict path, end to end from the port to what the author sees.
 *
 * Component tier because none of this is visible from a unit test of either half: the hook holds
 * the revision, the editor holds the document, and the whole question — does the author's work
 * survive a collision — is only answerable where the two meet.
 */

const LABELS: NutritionWorkspaceLabels = {
  title: 'Nutrition plan',
  none: 'No nutrition plan has been written yet.',
  noneHint: 'Meals go here.',
  create: 'Create a nutrition plan',
  loading: 'Loading the nutrition plan',
  loadFailed: 'The nutrition plan could not be loaded.',
  retry: 'Try again',
  saveFailed: 'Your changes were not saved.',
  conflictTitle: 'This plan was changed elsewhere',
  conflictBody: 'Someone else saved this nutrition plan while you were editing it.',
  conflictKeep: 'Keep mine and save it again',
  conflictDiscard: 'Discard mine and use theirs',
  conflictDismiss: 'Decide later',
  newTitle: 'Nutrition plan',
  firstMeal: 'Breakfast',
  firstMealWhen: 'on waking',
  builder: {
    heading: 'Meals',
    addMeal: 'Add meal',
    removeMeal: 'Remove meal',
    addItem: 'Add item',
    removeItem: 'Remove item',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save',
    mealName: 'Meal name',
    mealWhen: 'When',
    food: 'Food',
    amount: 'Amount',
    moveTo: 'In meal',
    newMealName: 'New meal',
    newFood: 'New food',
    newAmount: '100 g',
    empty: 'This plan has no meals yet.',
    noItems: 'Nothing in this meal yet.',
  },
}

const plan = (mealName: string): NutritionSnapshot => ({
  id: 'n1',
  title: 'Base',
  meals: [{ id: 'm1', name: mealName, when: 'on waking', order: 0, items: [] }],
})

/** What was read, and what the other author left behind — at a LATER revision. */
const MINE: Loaded<NutritionSnapshot> = { artefact: plan('Breakfast'), revision: 3 }
const THEIRS: Loaded<NutritionSnapshot> = { artefact: plan('Their breakfast'), revision: 7 }

type SavePort = NutritionPorts['nutrition']['save']

const mount = (save: SavePort) => {
  const ports: NutritionPorts = {
    nutrition: { current: () => Promise.resolve(MINE), save },
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <SubjectProvider value={'a-1' as SubjectId}>
        <NutritionPortsProvider value={ports}>
          <NutritionWorkspace locale="en" labels={LABELS} />
        </NutritionPortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )
}

/** Collide once, then behave — the shape of every real conflict, which is resolvable. */
const collidesOnce = () => {
  let collided = false
  return vi.fn<SavePort>((artefact, revision) => {
    if (collided) return Promise.resolve({ artefact, revision: (revision ?? 0) + 1 })
    collided = true
    return Promise.reject(new NutritionConflictError(THEIRS))
  })
}

/** Rename the only meal and press Save, which is the smallest edit that can collide. */
const editAndSave = async (to: string) => {
  const name = await screen.findByLabelText('Meal name')
  await userEvent.clear(name)
  await userEvent.type(name, to)
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('a collision is shown, not reported as a failure', () => {
  it('replaces the generic banner with the resolution', async () => {
    // The banner said "we could not save" — the wrong sentence for an event where nothing broke,
    // and one that left the author nothing to do but collide again.
    mount(collidesOnce())
    await editAndSave('Pre-training')

    expect(await screen.findByText(LABELS.conflictTitle)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.saveFailed)).not.toBeInTheDocument()
  })

  it('shows nothing of the sort when the save simply landed', async () => {
    mount(vi.fn<SavePort>((artefact, revision) => Promise.resolve({ artefact, revision })))
    await editAndSave('Pre-training')

    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
  })
})

describe('keep mine', () => {
  it('re-sends the author’s plan onto the revision the collision revealed', async () => {
    /*
      The heart of it. Sending it onto revision 3 again — the one the cache still holds — would
      collide for the same reason forever, so the author's only escape from a conflict would be to
      retype their work into somebody else's version.
    */
    const save = collidesOnce()
    mount(save)
    await editAndSave('Pre-training')

    await userEvent.click(await screen.findByRole('button', { name: LABELS.conflictKeep }))

    expect(save).toHaveBeenCalledTimes(2)
    const [artefact, revision] = save.mock.calls[1]!
    expect(artefact.meals[0]?.name).toBe('Pre-training')
    expect(revision).toBe(THEIRS.revision)
  })

  it('leaves the author’s document on screen, and the dialog behind', async () => {
    const save = collidesOnce()
    mount(save)
    await editAndSave('Pre-training')
    await userEvent.click(await screen.findByRole('button', { name: LABELS.conflictKeep }))

    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Meal name')).toHaveValue('Pre-training')
  })
})

describe('take theirs', () => {
  it('adopts the server’s document and sends nothing', async () => {
    // The server already holds this plan at this revision; a save here would be a round trip whose
    // only effect is to move the revision everyone else is quoting.
    const save = collidesOnce()
    mount(save)
    await editAndSave('Pre-training')

    await userEvent.click(await screen.findByRole('button', { name: LABELS.conflictDiscard }))

    // The editor is rehydrated, not merely re-rendered: it memoises its store on the plan's id, and
    // both versions ARE the same plan — so without a remount the discarded document would stay on
    // screen and the next save would quietly restore it.
    expect(await screen.findByLabelText('Meal name')).toHaveValue('Their breakfast')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('leaves the adopted plan saveable, at the revision it came with', async () => {
    const save = collidesOnce()
    mount(save)
    await editAndSave('Pre-training')
    await userEvent.click(await screen.findByRole('button', { name: LABELS.conflictDiscard }))
    await screen.findByLabelText('Meal name')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(save.mock.calls[1]?.[1]).toBe(THEIRS.revision)
  })
})

describe('deciding later', () => {
  it('puts the question down without touching either version', async () => {
    // Two irreversible choices and no way out is a dialog that gets answered at random.
    const save = collidesOnce()
    mount(save)
    await editAndSave('Pre-training')

    await userEvent.click(await screen.findByRole('button', { name: LABELS.conflictDismiss }))

    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Meal name')).toHaveValue('Pre-training')
    expect(save).toHaveBeenCalledTimes(1)
  })
})
