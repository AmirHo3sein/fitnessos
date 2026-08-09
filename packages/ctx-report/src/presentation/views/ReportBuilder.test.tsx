import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { ReportSnapshot } from '../../editor/schema'
import { ReportBuilder, type ReportBuilderLabels } from './ReportBuilder'

/**
 * What jsdom CAN test about a spatial editor, which is deliberately not the geometry.
 *
 * `getBoundingClientRect` returns zeros here, there is no compositor, and pointer capture is a
 * stub — so drag, snap and hit-testing cannot be exercised, and a passing test of them would be
 * a false positive. Those live in Playwright (handbook §4.3), and the pure geometry is already
 * unit-tested in `editor-engine` with no DOM at all.
 *
 * What is left is still worth pinning: that tiles render at their document positions, that the
 * commands dispatch, and that the commit boundary behaves.
 */

const LABELS: ReportBuilderLabels = {
  heading: 'Report',
  addTile: 'Add tile',
  removeTile: 'Remove',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save',
  newTileLabel: 'New tile',
  empty: 'This report is empty.',
}

const report = (): ReportSnapshot => ({
  id: 'r1',
  title: 'August review',
  tiles: [
    {
      id: 't1',
      x: 40,
      y: 60,
      width: 200,
      height: 120,
      content: { kind: 'indicator', indicatorKind: 'estimated-1rm', fallbackLabel: 'Squat 1RM' },
    },
  ],
})

type SaveFn = (report: ReportSnapshot) => boolean | Promise<boolean>

const mount = (onSave: Mock<SaveFn> = vi.fn<SaveFn>(() => true)) => {
  render(<ReportBuilder report={report()} locale="en" labels={LABELS} onSave={onSave} />)
  return onSave
}

describe('rendering', () => {
  it('places a tile at its document position', () => {
    // Document units are pixels for this editor (D-04), so position maps straight to style.
    mount()
    const tile = screen.getByTestId('tile-t1')
    expect(tile).toHaveStyle({ left: '40px', top: '60px', width: '200px', height: '120px' })
  })

  it('shows the reference’s fallback label', () => {
    // D-08: the only renderable content when resolution fails. A tile that showed nothing until
    // the resolver answered would flash empty on every load.
    mount()
    expect(screen.getByText('Squat 1RM')).toBeInTheDocument()
  })

  it('explains an empty canvas rather than showing a blank box', () => {
    render(
      <ReportBuilder
        report={{ id: 'r2', title: 'Empty', tiles: [] }}
        locale="en"
        labels={LABELS}
        onSave={vi.fn<SaveFn>(() => true)}
      />,
    )
    expect(screen.getByText('This report is empty.')).toBeInTheDocument()
  })
})

describe('commands', () => {
  it('adds a tile on top of what is already there', async () => {
    // Appended to `rootIds`, which is paint order here — the thing the user just made should be
    // the thing they can see.
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.tiles).toHaveLength(2)
    expect(saved.tiles[1]?.content).toMatchObject({ fallbackLabel: 'New tile' })
  })

  it('removes a tile', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Squat 1RM' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![0].tiles).toHaveLength(0)
  })

  it('undo reverses a removal', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Squat 1RM' }))
    expect(screen.queryByTestId('tile-t1')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('tile-t1')).toBeInTheDocument()
  })

  it('moves the commit boundary only when the save landed', async () => {
    mount(vi.fn<SaveFn>(() => false))
    await userEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })
})

describe('what the builder preserves', () => {
  it('carries the report’s id and title through a save', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.id).toBe('r1')
    expect(saved.title).toBe('August review')
  })

  it('does not reorder tiles, because order is paint order', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add tile' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The original tile stays first: sorting would silently change what draws on top.
    expect(onSave.mock.calls[0]![0].tiles[0]?.id).toBe('t1')
  })
})
