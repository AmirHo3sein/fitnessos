import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { ProgramVersionSnapshot } from '../../application/index'
import { ProgramBuilder, type BuilderLabels } from './ProgramBuilder'

const LABELS: BuilderLabels = {
  heading: 'Programme',
  addBlock: 'Add block',
  removeBlock: 'Remove',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save',
  blockName: 'Block name',
  progression: { fixed: 'Fixed', linear: 'Linear', autoregulated: 'Autoregulated' },
  rate: 'per cycle',
  newBlockName: 'New block',
  empty: 'No blocks yet.',
}

const version = (): ProgramVersionSnapshot =>
  ({
    id: 'v1',
    programId: 'p1',
    versionNumber: 3,
    blocks: [
      { id: 'b1', name: 'Preparation', order: 0, progression: { kind: 'fixed', ratePercent: null } },
      { id: 'b2', name: 'Accumulation', order: 1, progression: { kind: 'linear', ratePercent: 2.5 } },
    ],
    servesGoal: { goalId: 'g1', rationale: 'base phase' },
    authoredBy: { decidedBy: 'coach-1', proposedBy: 'human' },
  }) as unknown as ProgramVersionSnapshot

type SaveFn = (version: ProgramVersionSnapshot) => boolean | Promise<boolean>

/**
 * Typed explicitly rather than inferred from the default. `vi.fn(() => true)` infers a
 * zero-argument mock, and `mock.calls[0][0]` on one of those is `never` — the assertions below
 * would compile against nothing.
 */
const mount = (onSave: Mock<SaveFn> = vi.fn<SaveFn>(() => true)) => {
  render(<ProgramBuilder version={version()} locale="en" labels={LABELS} onSave={onSave} />)
  return onSave
}

describe('editing', () => {
  it('renders the programme’s blocks in order', () => {
    mount()
    const inputs = screen.getAllByLabelText('Block name')
    expect(inputs[0]).toHaveValue('Preparation')
    expect(inputs[1]).toHaveValue('Accumulation')
  })

  it('renames a block and saves the change', async () => {
    const onSave = mount()
    const input = screen.getAllByLabelText('Block name')[0]!
    await userEvent.clear(input)
    await userEvent.type(input, 'Base')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledOnce()
    const saved = onSave.mock.calls[0]![0]
    expect(saved.blocks[0]?.name).toBe('Base')
  })

  it('adds a block at the end', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add block' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.blocks).toHaveLength(3)
    expect(saved.blocks[2]?.name).toBe('New block')
    // Orders stay contiguous because position IS the order.
    expect(saved.blocks.map((b) => b.order)).toEqual([0, 1, 2])
  })

  it('removes a block and renumbers the rest', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Preparation' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.blocks).toHaveLength(1)
    expect(saved.blocks[0]?.name).toBe('Accumulation')
    expect(saved.blocks[0]?.order).toBe(0)
  })

  it('clears the rate when progression moves away from linear', async () => {
    // A stale rate on a fixed block reads as meaningful to whoever opens the programme next, and
    // the domain constructor rejects it on save — a validation error for something the user never
    // typed.
    const onSave = mount()
    const rows = screen.getAllByRole('button', { name: 'Fixed' })
    await userEvent.click(rows[1]!)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.blocks[1]?.progression).toEqual({ kind: 'fixed', ratePercent: null })
  })

  it('sets a default rate when progression becomes linear', async () => {
    const onSave = mount()
    await userEvent.click(screen.getAllByRole('button', { name: 'Linear' })[0]!)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.blocks[0]?.progression.kind).toBe('linear')
    expect(saved.blocks[0]?.progression.ratePercent).toBe(2.5)
  })
})

describe('undo', () => {
  it('is disabled until something is edited', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('reverses a removal, restoring the block and its position', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Preparation' }))
    expect(screen.getAllByLabelText('Block name')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

    const inputs = screen.getAllByLabelText('Block name')
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toHaveValue('Preparation')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = onSave.mock.calls[0]![0]
    expect(saved.blocks.map((b) => b.name)).toEqual(['Preparation', 'Accumulation'])
  })

  it('coalesces a burst of typing into ONE undo', async () => {
    // A user typing a block name means one change, not one per keystroke. Without coalescing, undo
    // would step back through every character.
    mount()
    const input = screen.getAllByLabelText('Block name')[0]!
    await userEvent.clear(input)
    await userEvent.type(input, 'Base')

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    // Back past the whole burst, not one character of it.
    expect(screen.getAllByLabelText('Block name')[0]).not.toHaveValue('Bas')
  })

  it('redo reapplies what undo reversed', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Preparation' }))
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getAllByLabelText('Block name')).toHaveLength(1)
  })

  it('a save that LANDED creates a commit boundary undo cannot cross', async () => {
    // Undoing past a save would leave the local document in a state the server has never seen.
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add block' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('a save that FAILED does not', async () => {
    // The trap this guards: commit on the button press rather than on the result. A coach whose
    // save is refused would be left holding edits they can neither retry nor reverse — the worst
    // available outcome, because the work is visible on screen and unreachable.
    mount(vi.fn<SaveFn>(() => false))
    await userEvent.click(screen.getByRole('button', { name: 'Add block' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })

  it('waits for an async save before moving the boundary', async () => {
    let settle: (persisted: boolean) => void = () => undefined
    mount(vi.fn<SaveFn>(() => new Promise<boolean>((resolve) => (settle = resolve))))

    await userEvent.click(screen.getByRole('button', { name: 'Add block' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    // Still in flight: the server has not confirmed anything yet.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()

    await act(() => {
      settle(true)
      // Returned so `act` flushes the microtask the resolution schedules — that is where the
      // builder's commit boundary is actually pushed.
      return Promise.resolve()
    })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })
})

describe('fields the builder does not edit', () => {
  it('preserves servesGoal, version number and authorship through a save', async () => {
    // The silent-data-loss case D-09 exists for: edit a name, and the coach's stated purpose is
    // still there afterwards.
    const onSave = mount()
    const input = screen.getAllByLabelText('Block name')[0]!
    await userEvent.clear(input)
    await userEvent.type(input, 'X')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.servesGoal).toEqual({ goalId: 'g1', rationale: 'base phase' })
    expect(saved.versionNumber).toBe(3)
    expect(saved.authoredBy.decidedBy).toBe('coach-1')
  })
})
