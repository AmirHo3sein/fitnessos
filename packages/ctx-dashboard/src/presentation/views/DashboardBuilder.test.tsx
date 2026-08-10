import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { DashboardSnapshot } from '../../editor/schema'
import { DashboardBuilder, type DashboardBuilderLabels } from './DashboardBuilder'

/**
 * What jsdom can honestly answer about a grid editor.
 *
 * Not the drag: `getBoundingClientRect` returns zeros, so cell arithmetic has nothing to work
 * from and a passing test would be a false positive. That lives in Playwright; the collision and
 * compaction maths underneath has its own tests with no DOM at all.
 */

const LABELS: DashboardBuilderLabels = {
  heading: 'Layout',
  addWidget: 'Add widget',
  removeWidget: 'Remove',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save',
  newWidgetLabel: 'New widget',
  empty: 'This dashboard is empty.',
  keyboardHint: 'Arrow keys move the focused widget.',
  widgetMovable: 'movable with the arrow keys',
  content: { 'upcoming-sessions': 'Upcoming sessions', 'unjudged-proposals': 'Awaiting judgement' },
}

const dashboard = (): DashboardSnapshot => ({
  id: 'd1',
  title: 'Overview',
  columns: 12,
  widgets: [
    {
      id: 'w1',
      x: 0,
      y: 0,
      width: 4,
      height: 2,
      content: { kind: 'indicator', indicatorKind: 'estimated-1rm', fallbackLabel: 'Squat 1RM' },
    },
    { id: 'w2', x: 0, y: 2, width: 4, height: 2, content: { kind: 'upcoming-sessions' } },
  ],
})

type SaveFn = (d: DashboardSnapshot) => boolean | Promise<boolean>

const mount = (onSave: Mock<SaveFn> = vi.fn<SaveFn>(() => true)) => {
  render(
    <DashboardBuilder dashboard={dashboard()} locale="en" labels={LABELS} onSave={onSave} />,
  )
  return onSave
}

describe('rendering', () => {
  it('positions a widget by percentage of the column count, not pixels', () => {
    // Columns are fluid so the same document reflows at any width. A pixel offset would fix the
    // layout to whatever screen it was authored on.
    mount()
    const w = screen.getByTestId('widget-w2')
    expect(w).toHaveStyle({ width: `${String((4 / 12) * 100)}%` })
  })

  it('uses a LOGICAL inline offset so the grid is not mirrored in RTL', () => {
    /**
     * Column 0 is where the reader starts — the right-hand edge in Persian. `left` would mirror
     * every dashboard the moment the language changed, so a layout authored in Persian would
     * arrive backwards for an English-reading coach looking at the same athlete.
     */
    mount()
    expect(screen.getByTestId('widget-w1').style.insetInlineStart).toBe('0%')
    expect(screen.getByTestId('widget-w1').style.left).toBe('')
  })

  it('shows the reference fallback for an indicator and a label for the rest', () => {
    mount()
    expect(screen.getByText('Squat 1RM')).toBeInTheDocument()
    expect(screen.getByText('Upcoming sessions')).toBeInTheDocument()
  })

  it('explains an empty grid', () => {
    render(
      <DashboardBuilder
        dashboard={{ id: 'd2', title: 'Empty', columns: 12, widgets: [] }}
        locale="en"
        labels={LABELS}
        onSave={vi.fn<SaveFn>(() => true)}
      />,
    )
    expect(screen.getByText('This dashboard is empty.')).toBeInTheDocument()
  })
})

describe('commands', () => {
  it('adds a widget BELOW everything, so nothing already arranged is displaced', () => {
    const onSave = mount()
    return userEvent
      .click(screen.getByRole('button', { name: 'Add widget' }))
      .then(() => userEvent.click(screen.getByRole('button', { name: 'Save' })))
      .then(() => {
        const saved = onSave.mock.calls[0]![0]
        expect(saved.widgets).toHaveLength(3)
        expect(saved.widgets[2]?.y).toBe(4)
      })
  })

  it('removes a widget and lifts what was below it, as ONE undo', async () => {
    /**
     * Two entries would mean the first undo restored the widget on top of whatever had risen
     * into its place — a state the grid forbids, reached by pressing undo once.
     */
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Squat 1RM' }))
    expect(screen.queryByTestId('widget-w1')).not.toBeInTheDocument()
    // The one below rose into the gap.
    expect(screen.getByTestId('widget-w2').style.top).toBe('0px')

    // ONE undo restores the widget AND puts the other back down. No save in between: a save is
    // a commit boundary, and undoing past one is correctly refused — which is what the previous
    // version of this test tripped over.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('widget-w1')).toBeInTheDocument()
    expect(screen.getByTestId('widget-w2').style.top).toBe(`${String(2 * 96)}px`)
  })

  it('saves the compacted layout', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Squat 1RM' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![0].widgets).toEqual([expect.objectContaining({ id: 'w2', y: 0 })])
  })

  it('moves the commit boundary only when the save landed', async () => {
    mount(vi.fn<SaveFn>(() => false))
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })
})

describe('what the builder preserves', () => {
  it('carries id, title and column count through a save', async () => {
    // `columns` is preserved rather than editable: changing it reflows every widget, which is a
    // command with its own confirmation rather than a property to nudge.
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved).toMatchObject({ id: 'd1', title: 'Overview', columns: 12 })
  })
})

describe('moving a widget without a pointer', () => {
  /**
   * The gap Phase 6 found: position was pointer-only in all three drag-based builders — no
   * `onKeyDown`, no focusable item. A WCAG 2.1.1 failure at level A that axe cannot see.
   */
  it('nudges a focused widget by one CELL', async () => {
    // A cell, because a cell is the only position this grid has. Pixels would be a unit the document
    // cannot store.
    const onSave = mount()
    const widget = screen.getAllByRole('group')[0]!
    widget.focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(screen.getByRole('button', { name: LABELS.save }))

    const saved = onSave.mock.calls[0]![0].widgets
    expect(saved[0]!.y).toBe(1)
  })

  it('displaces an occupant exactly as a drop does', async () => {
    /*
     * `movesFor` for both input methods. If the keyboard had its own placement logic, a nudge could
     * land somewhere a drag could not — two rules for one grid, differing only in how you asked.
     */
    const onSave = mount()
    const widget = screen.getAllByRole('group')[0]!
    widget.focus()
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.click(screen.getByRole('button', { name: LABELS.save }))

    const saved = onSave.mock.calls[0]![0].widgets
    // Nothing occupies two cells at once, whatever moved to make room.
    const cells = saved.map((w) => `${String(w.x)},${String(w.y)}`)
    expect(new Set(cells).size).toBe(cells.length)
  })

  it('does not consume an undo for a press that changes nothing', async () => {
    // Holding an arrow at the edge of the grid must not fill the history with no-ops.
    mount()
    const widget = screen.getAllByRole('group')[0]!
    widget.focus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(screen.getByRole('button', { name: LABELS.undo })).toBeDisabled()
  })

  it('names the widget and says what it responds to', () => {
    mount()
    const name = screen.getAllByRole('group')[0]!.getAttribute('aria-label') ?? ''
    expect(name).toContain('movable with the arrow keys')
  })
})
