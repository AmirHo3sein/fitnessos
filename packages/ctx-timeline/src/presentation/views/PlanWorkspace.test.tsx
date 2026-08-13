import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SubjectProvider } from '@fitnessos/ui'
import type { SubjectId } from '@fitnessos/kernel'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { PlanConflictError, type Loaded, type TimelinePorts } from '../../application/index'
import type { PlanSnapshot } from '../../editor/schema'
import { TimelinePortsProvider } from '../di'
import { PlanWorkspace, type PlanWorkspaceLabels } from './PlanWorkspace'

/**
 * Component tier: a collision, from the port that reports it to the choice the author makes.
 *
 * The interesting half is not that a card appears. It is what each button SENDS — a "keep mine"
 * that writes the local document onto the stale revision is indistinguishable on screen from one
 * that writes onto the server's, and only the second one lands.
 */

const LABELS: PlanWorkspaceLabels = {
  title: 'Training plan',
  none: 'No plan yet',
  noneHint: 'A plan lays out phases over time.',
  create: 'Create one',
  loading: 'Loading the plan',
  loadFailed: 'The plan could not be loaded.',
  retry: 'Try again',
  saveFailed: 'Your changes could not be saved.',
  conflictTitle: 'This plan was changed elsewhere',
  conflictBody: 'Someone else saved the plan while you were editing it.',
  conflictKeep: 'Keep mine and save it',
  conflictDiscard: 'Discard mine and take theirs',
  conflictDismiss: 'Decide later',
  newTitle: 'This season',
  firstPhase: 'Accumulation',
  builder: {
    heading: 'Phases',
    addPhase: 'Add phase',
    removePhase: 'Remove',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save',
    phaseLabel: 'Phase',
    newPhaseLabel: 'New phase',
    empty: 'This plan has no phases yet.',
    weeks: 'weeks',
    refused: 'That would overlap another phase.',
    keyboardHint: 'Arrow keys move the focused phase by a week.',
    phaseMovable: 'movable with the arrow keys',
  },
}

const TODAY = { year: 2026, month: 1, day: 5 }

const mine = (): PlanSnapshot => ({
  id: 'plan-1',
  title: 'Spring',
  epoch: TODAY,
  phases: [{ id: 'p1', label: 'Accumulation', start: 0, length: 28, programId: null, servesGoal: null }],
})

/** The same plan id — a collision is two authors on ONE artefact, not two artefacts. */
const theirs = (): PlanSnapshot => ({
  id: 'plan-1',
  title: 'Spring',
  epoch: TODAY,
  phases: [{ id: 'p9', label: 'Realisation', start: 0, length: 35, programId: null, servesGoal: null }],
})

/** The revision the server holds, which is NOT the one this client read. */
const SERVER_REVISION = 9

type SaveFn = TimelinePorts['timeline']['save']

const mount = (save: Mock<SaveFn>) => {
  const ports: TimelinePorts = {
    timeline: {
      current: () => Promise.resolve<Loaded<PlanSnapshot>>({ artefact: mine(), revision: 4 }),
      save,
    },
  }
  // retry: false, or a rejecting save waits out the backoff before the card appears.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <SubjectProvider value={'a-1' as SubjectId}>
        <TimelinePortsProvider value={ports}>
          <PlanWorkspace locale="en" labels={LABELS} today={TODAY} />
        </TimelinePortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )
  return save
}

/** A save that collides once, then accepts whatever comes next. */
const collidesOnce = (): Mock<SaveFn> => {
  let collided = false
  return vi.fn<SaveFn>((plan, baseRevision) => {
    if (collided) return Promise.resolve({ artefact: plan, revision: (baseRevision ?? 0) + 1 })
    collided = true
    return Promise.reject(new PlanConflictError({ artefact: theirs(), revision: SERVER_REVISION }))
  })
}

const collide = async (save: Mock<SaveFn>) => {
  mount(save)
  await screen.findByTestId('phase-p1')
  await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
  await screen.findByText(LABELS.conflictTitle)
}

describe('a save that collided', () => {
  it('shows the two versions instead of the generic failure banner', async () => {
    /*
     * Nothing broke — someone else got there first — so "we could not store your change" is both
     * true and useless. It also used to be ALL the author got, which is the state this replaces.
     */
    await collide(collidesOnce())

    expect(screen.getByText(LABELS.conflictBody)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.saveFailed)).not.toBeInTheDocument()
  })

  it('keeps the author IN the editor with their work on screen', async () => {
    // The local document is never swapped out from under an author mid-edit: it is half of what
    // they are being asked to choose between.
    await collide(collidesOnce())

    expect(screen.getByTestId('phase-p1')).toBeInTheDocument()
  })

  it('can be dismissed without choosing, and leaves the document alone', async () => {
    await collide(collidesOnce())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDismiss }))

    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    expect(screen.getByTestId('phase-p1')).toBeInTheDocument()
  })
})

describe('keep mine', () => {
  it("re-saves the author's document onto the revision the SERVER named", async () => {
    /*
     * The whole point. A retry that asserted the revision this client read would 409 for exactly
     * the same reason, forever — visible, and still unresolvable.
     */
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    expect(save).toHaveBeenCalledTimes(2)
    const [plan, baseRevision] = save.mock.calls[1]!
    expect(baseRevision).toBe(SERVER_REVISION)
    expect(plan.phases).toEqual([expect.objectContaining({ id: 'p1', label: 'Accumulation' })])
  })

  it('carries the edits made before the collision, not the last loaded plan', async () => {
    // "Mine" is what the author pressed Save with. Re-reading the cache would send the document
    // they started from and quietly drop the work the collision was meant to protect.
    const save = collidesOnce()
    mount(save)
    await screen.findByTestId('phase-p1')
    await userEvent.click(screen.getByRole('button', { name: LABELS.builder.addPhase }))
    await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
    await screen.findByText(LABELS.conflictTitle)

    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))
    expect(save.mock.calls[1]![0].phases).toHaveLength(2)
  })

  it('clears the collision once the second write lands', async () => {
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    expect(screen.queryByText(LABELS.saveFailed)).not.toBeInTheDocument()
  })
})

describe('take theirs', () => {
  it("adopts the server's document and drops the local one", async () => {
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    // Remounted, because the plan id does not change when the document behind it does — without
    // that the canvas would still be showing the draft the author just gave up.
    expect(await screen.findByTestId('phase-p9')).toBeInTheDocument()
    expect(screen.queryByTestId('phase-p1')).not.toBeInTheDocument()
    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
  })

  it('writes nothing: adopting is a local decision until the next edit', async () => {
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    expect(save).toHaveBeenCalledTimes(1)
  })

  it("leaves the next save asserting the SERVER's revision", async () => {
    // The envelope is adopted, not the plan alone. Keeping the old revision here would make the
    // very next save collide again, for a conflict the author has already resolved.
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))
    await screen.findByTestId('phase-p9')

    await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
    expect(save.mock.calls[1]![1]).toBe(SERVER_REVISION)
  })
})
