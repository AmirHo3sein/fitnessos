import { SubjectProvider } from '@fitnessos/ui'
import { idFrom } from '@fitnessos/kernel'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  CheckInFormConflictError,
  type CheckInFormSnapshot,
  type Loaded,
  type MeasurementPorts,
} from '../../application/index'
import { MeasurementPortsProvider } from '../di'
import { CheckInFormWorkspace, type WorkspaceLabels } from './CheckInFormWorkspace'

const LABELS: WorkspaceLabels = {
  title: 'Check-in form',
  none: 'No check-in form yet',
  noneHint: 'Each question becomes an observation.',
  create: 'Create one',
  loading: 'Loading the form',
  loadFailed: 'The check-in form could not be loaded.',
  retry: 'Try again',
  saveFailed: 'Your changes could not be saved.',
  conflictTitle: 'This form was changed elsewhere',
  conflictBody: 'Someone else saved this check-in form while you were editing.',
  conflictKeep: 'Keep mine and save',
  conflictDiscard: 'Discard mine and take theirs',
  conflictDismiss: 'Close',
  newFormTitle: 'Morning check-in',
  builder: {
    heading: 'Questions',
    addField: 'Add question',
    removeField: 'Remove',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save',
    fieldLabel: 'Question',
    records: 'Records',
    unit: 'Unit',
    answerKind: { number: 'Number', scale: 'Scale', choice: 'Choice' },
    newFieldLabel: 'New question',
    empty: 'No questions yet.',
  },
}

const form = (label: string): CheckInFormSnapshot => ({
  id: 'form-1',
  title: 'Morning check-in',
  fields: [
    {
      id: 'f1',
      label,
      records: 'bodyweight',
      unit: 'kg',
      answer: { kind: 'number' },
      order: 0,
    },
  ],
})

/** What the coach has open: revision 3, which the server will refuse. */
const MINE: Loaded<CheckInFormSnapshot> = { artefact: form('Bodyweight'), revision: 3 }
/** What somebody else saved in the meantime, at the revision the refusal reports. */
const THEIRS: Loaded<CheckInFormSnapshot> = { artefact: form('Waist'), revision: 9 }

type Save = (
  form: CheckInFormSnapshot,
  baseRevision: number | null,
) => Promise<Loaded<CheckInFormSnapshot>>

/**
 * Mounted with a save that refuses ONCE, the way a real collision behaves: the second attempt
 * carries the revision the refusal named, so the server accepts it.
 */
const mount = (
  saveCheckInForm = vi.fn<Save>(),
  loaded: Loaded<CheckInFormSnapshot> | null = MINE,
) => {
  const ports = {
    measurement: {
      checkInForm: () => Promise.resolve(loaded),
      observations: vi.fn(),
      indicators: vi.fn(),
      record: vi.fn(),
      saveCheckInForm,
    },
  } as unknown as MeasurementPorts

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SubjectProvider value={idFrom<'AthleteId'>('athlete-1')}>
        <MeasurementPortsProvider value={ports}>
          <CheckInFormWorkspace locale="en" labels={LABELS} />
        </MeasurementPortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )
  return saveCheckInForm
}

/** Edit a question so the local document is demonstrably the coach's, then save it. */
const editAndSave = async (text: string) => {
  const input = await screen.findByLabelText('Question')
  await userEvent.clear(input)
  await userEvent.type(input, text)
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
}

const refuseOnce = () => {
  let refused = false
  return vi.fn<Save>((next, baseRevision) => {
    if (!refused) {
      refused = true
      return Promise.reject(new CheckInFormConflictError(THEIRS))
    }
    return Promise.resolve({ artefact: next, revision: (baseRevision ?? 0) + 1 })
  })
}

describe('a save that collided with another author', () => {
  it('shows what it collided with instead of the generic failure', async () => {
    // The whole point: a coach cannot choose between two versions they were never shown one of.
    mount(refuseOnce())
    await editAndSave('Bodyweight in the morning')

    expect(await screen.findByText(LABELS.conflictTitle)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.saveFailed)).not.toBeInTheDocument()
  })

  it('keeps mine by re-saving it ONTO the revision the server reported', async () => {
    // Without the second revision the cache still holds the base the server just refused, so every
    // retry quotes a dead precondition and the coach is stuck for ever.
    const save = mount(refuseOnce())
    await editAndSave('Bodyweight in the morning')
    await screen.findByText(LABELS.conflictTitle)

    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    const [sent, onto] = save.mock.calls[1]!
    expect(onto).toBe(THEIRS.revision)
    // The coach's document, not the server's — that is what "keep mine" means.
    expect(sent.fields[0]?.label).toBe('Bodyweight in the morning')
  })

  it('clears the conflict once keeping mine succeeded', async () => {
    const save = mount(refuseOnce())
    await editAndSave('Bodyweight in the morning')
    await screen.findByText(LABELS.conflictTitle)

    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('takes theirs by replacing the open document with the server’s', async () => {
    mount(refuseOnce())
    await editAndSave('Bodyweight in the morning')
    await screen.findByText(LABELS.conflictTitle)

    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    // Re-hydrated, not merely re-rendered. The builder keeps one store per form id, and the id did
    // not change — so adopting has to remount it or the coach goes on editing their own draft.
    expect(await screen.findByLabelText('Question')).toHaveValue('Waist')
    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
  })

  it('saves against the adopted revision afterwards, so taking theirs is not a loop', async () => {
    // Adopting the document without its revision would resolve the conflict on screen and recreate
    // it on the very next press.
    const save = mount(refuseOnce())
    await editAndSave('Bodyweight in the morning')
    await screen.findByText(LABELS.conflictTitle)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))
    await screen.findByLabelText('Question')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(save.mock.calls[1]![1]).toBe(THEIRS.revision)
  })

  it('can be dismissed without deciding, leaving the document open', async () => {
    // Closing is not a choice. Both versions still exist and the next save will collide again,
    // which is the honest consequence of not having chosen.
    const save = mount(refuseOnce())
    await editAndSave('Bodyweight in the morning')
    await screen.findByText(LABELS.conflictTitle)

    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDismiss }))

    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Question')).toHaveValue('Bodyweight in the morning')
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('a first save that collided', () => {
  it('reports the collision on the empty state, where a create can 409 too', async () => {
    // A first save carries no precondition, so it collides when a coach on another device authored
    // one first — and unreported, the Create button would simply appear to do nothing.
    mount(refuseOnce(), null)

    await userEvent.click(await screen.findByRole('button', { name: 'Create one' }))

    expect(await screen.findByText(LABELS.conflictTitle)).toBeInTheDocument()
  })
})
