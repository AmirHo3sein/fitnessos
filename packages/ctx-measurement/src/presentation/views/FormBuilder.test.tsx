import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { FormSnapshot } from '../../editor/schema'
import { FormBuilder, type FormBuilderLabels } from './FormBuilder'

const LABELS: FormBuilderLabels = {
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
}

const form = (): FormSnapshot => ({
  id: 'form-1',
  title: 'Morning check-in',
  fields: [
    { id: 'f1', label: 'Bodyweight', records: 'bodyweight', unit: 'kg', answer: { kind: 'number' }, order: 0 },
    { id: 'f2', label: 'Sleep', records: 'sleep', unit: 'h', answer: { kind: 'number' }, order: 1 },
  ],
})

type SaveFn = (form: FormSnapshot) => boolean | Promise<boolean>

const mount = (onSave: Mock<SaveFn> = vi.fn<SaveFn>(() => true)) => {
  render(<FormBuilder form={form()} locale="en" labels={LABELS} onSave={onSave} />)
  return onSave
}

describe('editing', () => {
  it('renders the form’s questions in order', () => {
    mount()
    const inputs = screen.getAllByLabelText('Question')
    expect(inputs[0]).toHaveValue('Bodyweight')
    expect(inputs[1]).toHaveValue('Sleep')
  })

  it('edits what a question records, which the aggregate requires', async () => {
    // A field that records nothing is the one thing a check-in form must not contain — it would
    // be a survey question, and the domain refuses it on save.
    const onSave = mount()
    const records = screen.getAllByLabelText('Records')[0]!
    await userEvent.clear(records)
    await userEvent.type(records, 'waist')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![0].fields[0]?.records).toBe('waist')
  })

  it('adds a question at the end with a contiguous order', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.fields).toHaveLength(3)
    // Position IS the order, so the builder never writes one and never has to renumber.
    expect(saved.fields.map((f) => f.order)).toEqual([0, 1, 2])
  })

  it('removes a question and renumbers the rest', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bodyweight' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.fields.map((f) => f.label)).toEqual(['Sleep'])
    expect(saved.fields[0]?.order).toBe(0)
  })

  it('changes the answer shape, and commit reassembles the variant', async () => {
    // The one place this builder genuinely differs from the Program Builder: the answer shape is
    // a closed union flattened into props, and commit has to put it back together.
    const onSave = mount()
    await userEvent.click(screen.getAllByRole('button', { name: 'Scale' })[0]!)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![0].fields[0]?.answer).toEqual({ kind: 'scale', min: 1, max: 5 })
  })
})

describe('undo, reused from the engine unchanged', () => {
  it('is disabled until something is edited', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('reverses a removal, restoring the question and its position', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bodyweight' }))
    expect(screen.getAllByLabelText('Question')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

    const inputs = screen.getAllByLabelText('Question')
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toHaveValue('Bodyweight')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0]![0].fields.map((f) => f.label)).toEqual(['Bodyweight', 'Sleep'])
  })

  it('coalesces a burst of typing into ONE undo', async () => {
    // Same guarantee as the Program Builder, from the same engine code — which is the point of
    // there being an engine.
    mount()
    const input = screen.getAllByLabelText('Question')[0]!
    await userEvent.clear(input)
    await userEvent.type(input, 'Mood')

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getAllByLabelText('Question')[0]).not.toHaveValue('Moo')
  })

  it('moves the commit boundary only when the save LANDED', async () => {
    // The trap: committing on the button press leaves a coach whose save was refused holding
    // edits they can neither retry nor reverse.
    mount(vi.fn<SaveFn>(() => false))
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })

  it('waits for an async save before moving the boundary', async () => {
    let settle: (persisted: boolean) => void = () => undefined
    mount(vi.fn<SaveFn>(() => new Promise<boolean>((resolve) => (settle = resolve))))

    await userEvent.click(screen.getByRole('button', { name: 'Add question' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()

    await act(() => {
      settle(true)
      return Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })
})

describe('fields the builder does not edit', () => {
  it('preserves the form’s id and title through a save', async () => {
    // The silent-data-loss case D-09 exists for.
    const onSave = mount()
    const input = screen.getAllByLabelText('Question')[0]!
    await userEvent.clear(input)
    await userEvent.type(input, 'X')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.id).toBe('form-1')
    expect(saved.title).toBe('Morning check-in')
  })
})
