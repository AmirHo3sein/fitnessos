import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { PlanSnapshot } from '../../editor/schema'
import { DAYS_PER_WEEK } from '../../topology/temporal'
import { TimelineBuilder, type TimelineBuilderLabels } from './TimelineBuilder'

/**
 * What jsdom can answer about a timeline: the geometry-free half.
 *
 * Drag and resize need real coordinates, so they live in Playwright. The placement rules
 * themselves — snapping, refusal, minimum length — are pure functions with 18 unit tests and no
 * DOM at all, which is where that logic belongs.
 */

const LABELS: TimelineBuilderLabels = {
  heading: 'Plan',
  addPhase: 'Add phase',
  removePhase: 'Remove',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save',
  phaseLabel: 'Phase',
  newPhaseLabel: 'New phase',
  empty: 'This plan is empty.',
  weeks: 'weeks',
  refused: 'That would overlap another phase.',
}

const plan = (): PlanSnapshot => ({
  id: 'plan-1',
  title: 'Spring',
  epoch: { year: 2026, month: 1, day: 5 },
  phases: [
    { id: 'p1', label: 'Accumulation', start: 0, length: 28, programId: null, servesGoal: null },
    { id: 'p2', label: 'Intensification', start: 28, length: 21, programId: null, servesGoal: null },
  ],
})

type SaveFn = (p: PlanSnapshot) => boolean | Promise<boolean>

const mount = (onSave: Mock<SaveFn> = vi.fn<SaveFn>(() => true)) => {
  render(<TimelineBuilder plan={plan()} locale="en" labels={LABELS} onSave={onSave} />)
  return onSave
}

describe('rendering', () => {
  it('places a phase by day offset and sizes it by length', () => {
    mount()
    expect(screen.getByTestId('phase-p2')).toHaveAttribute('data-start', '28')
    expect(screen.getByTestId('phase-p2')).toHaveAttribute('data-length', '21')
  })

  it('uses a LOGICAL inline offset, so later time runs with the reading direction', () => {
    /**
     * A timeline that ran left-to-right in an RTL layout would put the future behind the past.
     * That is not a styling preference — it inverts the only axis the screen has.
     */
    mount()
    const phase = screen.getByTestId('phase-p1')
    // '0' rather than '0px': React omits the unit for a zero length, which is why this asserts
    // the raw style value rather than going through `toHaveStyle`.
    expect(phase.style.insetInlineStart).toBe('0')
    expect(phase.style.left).toBe('')

    // A non-zero offset keeps its unit, which is the case that would break if the property were
    // switched back to a physical one.
    expect(screen.getByTestId('phase-p2').style.insetInlineStart).toBe('336px')
  })

  it('shows the length in weeks and the start as a date', () => {
    // Weeks because that is the unit a coach plans in; a date because that is what they schedule
    // against. Days would be neither.
    mount()
    expect(screen.getByText('4')).toBeInTheDocument()
    // `Intl` with the bare `en` locale renders "January 5, 2026"; matching a partial that assumed
    // day-first would have passed only in en-GB.
    expect(screen.getByText(/January 5, 2026/)).toBeInTheDocument()
  })

  it('explains an empty plan', () => {
    render(
      <TimelineBuilder
        plan={{ id: 'p', title: 'Empty', epoch: { year: 2026, month: 1, day: 5 }, phases: [] }}
        locale="en"
        labels={LABELS}
        onSave={vi.fn<SaveFn>(() => true)}
      />,
    )
    expect(screen.getByText('This plan is empty.')).toBeInTheDocument()
  })
})

describe('commands', () => {
  it('adds a phase after the last one', async () => {
    // What a coach means by "add a phase". `firstFreeStart` finds a gap instead when the plan is
    // not contiguous, which its own tests cover.
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add phase' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.phases).toHaveLength(3)
    expect(saved.phases[2]?.start).toBe(49)
    expect(saved.phases[2]?.length).toBe(4 * DAYS_PER_WEEK)
  })

  it('removes a phase and leaves the others where they were', async () => {
    // No compaction, unlike the grid: closing a gap in time would reschedule training nobody
    // asked to move.
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Accumulation' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.phases).toEqual([expect.objectContaining({ id: 'p2', start: 28 })])
  })

  it('undo restores a removed phase', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Accumulation' }))
    expect(screen.queryByTestId('phase-p1')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('phase-p1')).toBeInTheDocument()
  })

  it('moves the commit boundary only when the save landed', async () => {
    mount(vi.fn<SaveFn>(() => false))
    await userEvent.click(screen.getByRole('button', { name: 'Add phase' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })
})

describe('what the builder preserves', () => {
  it('carries id, title and epoch through a save', async () => {
    // The epoch especially: every phase offset is relative to it, so changing it shifts the whole
    // plan — a command with its own confirmation, not a property to nudge on the canvas.
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add phase' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![0]).toMatchObject({
      id: 'plan-1',
      title: 'Spring',
      epoch: { year: 2026, month: 1, day: 5 },
    })
  })
})
