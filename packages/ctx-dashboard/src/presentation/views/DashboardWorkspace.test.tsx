import type { SubjectId } from '@fitnessos/kernel'
import { SubjectProvider } from '@fitnessos/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { DashboardConflictError, type DashboardPorts, type Loaded } from '../../application/index'
import type { DashboardSnapshot } from '../../editor/schema'
import { DashboardPortsProvider } from '../di'
import { DashboardWorkspace, type DashboardWorkspaceLabels } from './DashboardWorkspace'

/**
 * The collision, end to end through the workspace.
 *
 * Not the grid — jsdom has no layout engine and the builder's own tests already say what can
 * honestly be asserted there. What this tier can answer is the question the dialog exists for: does
 * the author's arrangement survive a save someone else got to first, and does the OTHER arrangement
 * arrive when they ask for it instead.
 */

const LABELS: DashboardWorkspaceLabels = {
  title: 'Dashboard layout',
  none: 'No layout yet',
  noneHint: 'A dashboard arranges published views.',
  create: 'Create one',
  loading: 'Loading the layout',
  loadFailed: 'The layout could not be loaded.',
  retry: 'Try again',
  saveFailed: 'Your changes could not be saved.',
  conflictTitle: 'This layout was changed elsewhere',
  conflictBody: 'Someone else saved a new arrangement.',
  conflictKeep: 'Keep mine and save again',
  conflictDiscard: 'Discard mine and take the saved layout',
  conflictDismiss: 'Decide later',
  newTitle: 'Overview',
  builder: {
    heading: 'Widgets',
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
  },
}

const widget = (id: string, label: string) => ({
  id,
  x: 0,
  y: 0,
  width: 4,
  height: 2,
  content: { kind: 'indicator', indicatorKind: 'estimated-1rm', fallbackLabel: label } as const,
})

const MINE: DashboardSnapshot = {
  id: 'd1',
  title: 'Overview',
  columns: 12,
  widgets: [widget('w1', 'Squat 1RM')],
}

/** The other author's — the SAME artefact id, arranged differently. That is what a collision is. */
const THEIRS: DashboardSnapshot = {
  id: 'd1',
  title: 'Overview',
  columns: 12,
  widgets: [widget('w9', 'Bench 1RM')],
}

type SaveFn = (
  dashboard: DashboardSnapshot,
  baseRevision: number | null,
) => Promise<Loaded<DashboardSnapshot>>

const mount = (save: Mock<SaveFn>) => {
  const ports: DashboardPorts = {
    dashboard: {
      current: () => Promise.resolve({ artefact: MINE, revision: 3 }),
      save,
    },
  }

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <SubjectProvider value={'a1' as SubjectId}>
        <DashboardPortsProvider value={ports}>
          <DashboardWorkspace locale="en" labels={LABELS} />
        </DashboardPortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )
  return save
}

/** A save that is refused because someone else wrote first — revision 7 is what they left behind. */
const refusedOnce = (): Mock<SaveFn> => {
  let calls = 0
  return vi.fn<SaveFn>(() => {
    calls += 1
    return calls === 1
      ? Promise.reject(new DashboardConflictError({ artefact: THEIRS, revision: 7 }))
      : Promise.resolve({ artefact: MINE, revision: 8 })
  })
}

/** Open the grid, add a widget so there is work to lose, and try to save it. */
const collide = async (save: Mock<SaveFn>) => {
  mount(save)
  await screen.findByTestId('dashboard-grid')
  await userEvent.click(screen.getByRole('button', { name: LABELS.builder.addWidget }))
  await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
  return screen.findByText(LABELS.conflictTitle)
}

describe('a collided save', () => {
  it('offers the choice INSTEAD of the generic failure banner', async () => {
    // "We could not store your change" is untrue here and unhelpful beside a card asking which
    // arrangement to keep — nothing broke, and the author has a decision to make.
    await collide(refusedOnce())
    expect(screen.queryByText(LABELS.saveFailed)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: LABELS.conflictKeep })).toBeInTheDocument()
  })

  it('leaves the author’s arrangement on the grid while they decide', async () => {
    await collide(refusedOnce())
    expect(screen.getByText('Squat 1RM')).toBeInTheDocument()
    expect(screen.queryByText('Bench 1RM')).not.toBeInTheDocument()
  })
})

describe('keeping mine', () => {
  it('re-sends the refused arrangement on the revision the SERVER reported', async () => {
    /*
     * The revision is the whole mechanism. Re-sending on the cached base (3) would quote a
     * precondition the server has already refused, so every retry would conflict again and the
     * author would be stuck with work they cannot store.
     */
    const save = refusedOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    const [document, baseRevision] = save.mock.calls[1] ?? []
    expect(baseRevision).toBe(7)
    // The author's layout, not the server's: two widgets, the one they added among them.
    expect(document?.widgets).toHaveLength(2)
  })

  it('clears the dialog once it lands', async () => {
    const save = refusedOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))
    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
  })
})

describe('taking theirs', () => {
  it('puts the other author’s arrangement on the grid, and sends nothing', async () => {
    // Nothing is sent because nothing needs to be: the conflict carried their artefact AND its
    // revision, which is a complete read. A refetch here would be a round trip for data in hand.
    const save = refusedOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    expect(await screen.findByText('Bench 1RM')).toBeInTheDocument()
    expect(screen.queryByText('Squat 1RM')).not.toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves the NEXT change against their revision', async () => {
    // The adopted envelope became the cached read, so the base is theirs (7) — not the dead 3 the
    // session began with.
    const save = refusedOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))
    await screen.findByText('Bench 1RM')

    await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
    expect(save.mock.calls[1]?.[1]).toBe(7)
  })
})

describe('deciding later', () => {
  it('puts the dialog away without resolving anything', async () => {
    // Dismissal is not a choice between the two arrangements — the local one stays, unsaved, and
    // the author can look at the grid before answering.
    const save = refusedOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDismiss }))

    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    expect(screen.getByText('Squat 1RM')).toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(1)
  })
})
