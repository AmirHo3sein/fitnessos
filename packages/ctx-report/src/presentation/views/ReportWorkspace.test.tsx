import type { SubjectId } from '@fitnessos/kernel'
import { SubjectProvider } from '@fitnessos/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { ReportConflictError, type Loaded, type ReportPorts } from '../../application/index'
import type { ReportSnapshot } from '../../editor/schema'
import { ReportPortsProvider } from '../di'
import { ReportWorkspace, type ReportWorkspaceLabels } from './ReportWorkspace'

/**
 * A save that collided with another author (BACKEND-CONTRACT §2.1a).
 *
 * The geometry is not what is under test here — that is the builder's business, and jsdom has no
 * layout engine to test it with. What is pinned is the resolution: that the coach is shown the
 * collision at all, that "keep mine" stores THEIR document against the revision the server quoted
 * back, and that "discard mine" actually puts the other version on screen.
 *
 * The last of those is the one that would rot silently. Both documents are the same report, so the
 * builder — which hydrates once, keyed on `report.id` — shows no change when the cache is replaced,
 * and a coach who chose the other version would go on editing their own.
 */

const LABELS: ReportWorkspaceLabels = {
  title: 'Report',
  none: 'No report yet',
  noneHint: 'A report points at published indicators.',
  create: 'Create one',
  loading: 'Loading the report',
  loadFailed: 'The report could not be loaded.',
  retry: 'Try again',
  saveFailed: 'Your changes could not be saved.',
  conflictTitle: 'This report was changed elsewhere',
  conflictBody: 'Someone else saved this report while you were editing.',
  conflictKeep: 'Keep mine and save again',
  conflictDiscard: 'Discard mine and load theirs',
  conflictDismiss: 'Decide later',
  newReportTitle: 'Monthly review',
  builder: {
    heading: 'Layout',
    addTile: 'Add tile',
    removeTile: 'Remove',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save',
    multiSelect: 'Select several',
    keyboardHint: 'Arrow keys move the focused tile.',
    tileMovable: 'movable with the arrow keys',
    alignLeft: 'Align left',
    alignTop: 'Align top',
    distributeX: 'Distribute',
    newTileLabel: 'New tile',
    empty: 'This report is empty.',
  },
}

const tile = (id: string, label: string) => ({
  id,
  x: 40,
  y: 60,
  width: 200,
  height: 120,
  content: { kind: 'indicator', indicatorKind: 'estimated-1rm', fallbackLabel: label } as const,
})

/** What this coach loaded and is editing. */
const MINE: Loaded<ReportSnapshot> = {
  artefact: { id: 'r1', title: 'August review', tiles: [tile('t1', 'Squat 1RM')] },
  revision: 3,
}

/** The same report as somebody else left it, one revision further on. */
const THEIRS: Loaded<ReportSnapshot> = {
  artefact: { id: 'r1', title: 'August review', tiles: [tile('t2', 'Their tile')] },
  revision: 7,
}

type SaveFn = (
  report: ReportSnapshot,
  baseRevision: number | null,
) => Promise<Loaded<ReportSnapshot>>

const mount = () => {
  const save = vi.fn<SaveFn>()
  // The first save collides; anything after it lands, so a resolution can be seen through.
  save.mockRejectedValueOnce(new ReportConflictError(THEIRS))
  save.mockResolvedValue({ artefact: THEIRS.artefact, revision: 8 })

  const ports = {
    report: { current: () => Promise.resolve(MINE), save },
  } as unknown as ReportPorts

  // Retries off: a rejected save here is the subject of the test, not a flake to ride out, and the
  // default backoff would make every assertion below wait for it.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <SubjectProvider value={'athlete-1' as SubjectId}>
        <ReportPortsProvider value={ports}>
          <ReportWorkspace locale="en" labels={LABELS} />
        </ReportPortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )

  return save
}

/** Load, edit, save — the state every test below starts from: a conflict on screen. */
const collide = async (save: Mock<SaveFn>) => {
  await screen.findByTestId('tile-t1')
  await userEvent.click(screen.getByRole('button', { name: LABELS.builder.addTile }))
  await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
  await screen.findByText(LABELS.conflictTitle)
  return save
}

describe('a collision', () => {
  it('is shown as a choice, not as a failure', async () => {
    // The generic banner said "could not be saved" and left the coach with nothing to do but press
    // Save into the same refusal. It must not appear beside the panel that offers a way out.
    await collide(mount())

    expect(screen.getByText(LABELS.conflictBody)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.saveFailed)).not.toBeInTheDocument()
  })

  it('can be dismissed without storing or discarding anything', async () => {
    // A coach may want to look at their own canvas before deciding. Closing the panel is not a
    // resolution: nothing is sent, and the local document is untouched.
    const save = await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDismiss }))

    await waitFor(() => {
      expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('tile-t1')).toBeInTheDocument()
  })
})

describe('keeping mine', () => {
  it('sends the author’s document again, onto the revision the server quoted back', async () => {
    /*
     * The whole point of the feature, and the half that is easy to get wrong: without the second
     * argument moving to 7 the retry quotes the base the server already refused, so it 409s for
     * ever and the coach cannot save their work at all.
     */
    const save = await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2)
    })
    const [document, base] = save.mock.calls[1]!
    expect(base).toBe(7)
    // The same document, not the server's: the added tile is still there and their tile is not.
    expect(document).toStrictEqual(save.mock.calls[0]![0])
    expect(document.tiles).toHaveLength(2)
    expect(document.tiles[0]?.id).toBe('t1')
  })

  it('closes the panel once the work is stored', async () => {
    await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    await waitFor(() => {
      expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    })
  })
})

describe('taking theirs', () => {
  it('puts the other author’s document on the canvas', async () => {
    // Not merely a cache write. Both documents are report `r1`, so nothing here re-hydrates on its
    // own — a coach who chose this and kept seeing their own tiles would reasonably conclude the
    // button was broken.
    await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    expect(await screen.findByTestId('tile-t2')).toBeInTheDocument()
    expect(screen.queryByTestId('tile-t1')).not.toBeInTheDocument()
    expect(screen.getByText('Their tile')).toBeInTheDocument()
  })

  it('stores nothing — discarding is a local decision', async () => {
    // Adopting somebody else's document is not an edit of it. A save here would write their
    // content back under this coach's hand for no reason, and bump the revision for everyone else.
    const save = await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    await screen.findByTestId('tile-t2')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('leaves the panel behind it', async () => {
    await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    await waitFor(() => {
      expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    })
  })
})
