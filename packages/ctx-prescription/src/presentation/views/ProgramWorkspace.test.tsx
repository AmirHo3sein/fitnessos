import type { SubjectId } from '@fitnessos/kernel'
import { SubjectProvider } from '@fitnessos/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  ProgramConflictError,
  type PrescriptionPorts,
  type ProgramSnapshot,
  type ReviseProgramInput,
} from '../../application/index'
import { PrescriptionPortsProvider } from '../di'
import { ProgramWorkspace, type WorkspaceLabels } from './ProgramWorkspace'

/**
 * A revision that collided with another author (BACKEND-CONTRACT §2.1).
 *
 * The programme was the LAST of the seven editors to get a resolution, and for a while it was the
 * only one that could not resolve anything. The panel offered two buttons: "keep my changes open",
 * which cleared the error and left `baseVersionId` pointing at the version the server had already
 * refused — so pressing Save produced the identical 409, for ever — and "discard", which left the
 * editing session. Versions are immutable (ADR-0008), so the work dropped that way was gone.
 *
 * What is pinned here is the way out: that "keep mine" re-sends THIS coach's blocks against the
 * version the server quoted back, and that "discard" actually puts the other version in the editor.
 * The second would rot silently — both sides are the same programme, and a coach who chose the
 * other version and went on seeing their own blocks would reasonably conclude the button was
 * broken.
 */

const LABELS: WorkspaceLabels = {
  title: 'Programme',
  version: 'Version',
  noProgram: 'No programme yet',
  noProgramHint: 'A coach writes the first one.',
  progression: { fixed: 'Fixed', linear: 'Linear', autoregulated: 'Autoregulated' },
  ratePerCycle: 'per cycle',
  authoredByHuman: 'by a coach',
  authoredByAssistant: 'by the assistant',
  loading: 'Loading the programme',
  failed: 'The programme could not be loaded.',
  servesGoal: 'Serves',
  refs: {
    loading: 'Loading',
    deleted: 'Deleted',
    forbidden: 'Not visible',
    unnamedGoal: 'A goal',
  },
  edit: 'Edit',
  cancel: 'Cancel',
  saveFailed: 'Your changes could not be saved.',
  conflictTitle: 'This programme was changed elsewhere',
  conflictBody: 'Someone else saved a new version while you were editing.',
  conflictKeep: 'Keep mine and save again',
  conflictDiscard: 'Discard mine and take theirs',
  conflictDismiss: 'Decide later',
  builder: {
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
  },
}

const block = (id: string, name: string, order: number) => ({
  id,
  name,
  order,
  progression: { kind: 'fixed', ratePercent: null } as const,
})

/** What this coach opened the editor on. */
const MINE = {
  id: 'p1',
  athleteId: 'athlete-1',
  title: 'Winter block',
  currentVersion: {
    id: 'v3',
    programId: 'p1',
    versionNumber: 3,
    blocks: [block('b1', 'Preparation', 0)],
    servesGoal: null,
    authoredBy: { decidedBy: 'coach-1', proposedBy: 'human' },
  },
} as unknown as ProgramSnapshot

/** The same programme, one revision further on, written by somebody else. */
const THEIRS = {
  id: 'p1',
  athleteId: 'athlete-1',
  title: 'Winter block',
  currentVersion: {
    id: 'v4',
    programId: 'p1',
    versionNumber: 4,
    blocks: [block('b9', 'Their peaking block', 0)],
    servesGoal: null,
    authoredBy: { decidedBy: 'coach-2', proposedBy: 'human' },
  },
} as unknown as ProgramSnapshot

type ReviseFn = (input: ReviseProgramInput, signal?: AbortSignal) => Promise<ProgramSnapshot>

const mount = () => {
  const revise = vi.fn<ReviseFn>()
  // The first revision collides; anything after it lands, so a resolution can be seen through.
  revise.mockRejectedValueOnce(new ProgramConflictError(THEIRS))
  revise.mockResolvedValue({
    ...MINE,
    currentVersion: { ...MINE.currentVersion, id: 'v5', versionNumber: 5 },
  } as ProgramSnapshot)

  const ports = {
    prescription: { currentProgram: () => Promise.resolve(MINE), revise },
  } as unknown as PrescriptionPorts

  // Retries off: a rejected revision here is the subject of the test, not a flake to ride out, and
  // the default backoff would make every assertion below wait for it.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <SubjectProvider value={'athlete-1' as SubjectId}>
        <PrescriptionPortsProvider value={ports}>
          <ProgramWorkspace locale="en" labels={LABELS} />
        </PrescriptionPortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )

  return revise
}

/** Open, edit, save — the state every test below starts from: a conflict on screen. */
const collide = async (revise: Mock<ReviseFn>) => {
  await userEvent.click(await screen.findByRole('button', { name: LABELS.edit }))
  await userEvent.click(await screen.findByRole('button', { name: LABELS.builder.addBlock }))
  await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
  await screen.findByText(LABELS.conflictTitle)
  return revise
}

describe('a collision', () => {
  it('is shown as a choice, not as a failure', async () => {
    await collide(mount())

    expect(screen.getByText(LABELS.conflictBody)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.saveFailed)).not.toBeInTheDocument()
  })

  it('can be dismissed without storing or discarding anything', async () => {
    const revise = await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDismiss }))

    await waitFor(() => {
      expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    })
    expect(revise).toHaveBeenCalledTimes(1)
    // The coach's own blocks are still in the editor — dismissing decides nothing.
    expect(screen.getAllByLabelText(LABELS.builder.blockName)[0]).toHaveValue('Preparation')
  })
})

describe('keeping mine', () => {
  it('sends the author’s blocks again, based on the version the server quoted back', async () => {
    /*
     * The half that is easy to get wrong, and the one that made this unusable: without
     * `baseVersionId` moving to v4 the retry quotes the base the server has already refused, so it
     * 409s again — and again — and the coach cannot store their work at all.
     */
    const revise = await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    await waitFor(() => {
      expect(revise).toHaveBeenCalledTimes(2)
    })
    const retried = revise.mock.calls[1]![0]
    expect(retried.baseVersionId).toBe('v4')
    // Their blocks, not the other author's: the added block is still there and theirs is not.
    expect(retried.blocks).toHaveLength(2)
    expect(retried.blocks.map((b) => b.name)).toEqual(['Preparation', LABELS.builder.newBlockName])
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
  it('puts the other author’s blocks in the editor', async () => {
    // The builder hydrates on `version.id`, so adopting the other version is what re-keys it. A
    // coach who chose this and kept seeing their own blocks would conclude the button was broken.
    await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    await waitFor(() => {
      expect(screen.getAllByLabelText(LABELS.builder.blockName)[0]).toHaveValue(
        'Their peaking block',
      )
    })
    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
  })

  it('stores nothing — discarding is a local decision', async () => {
    // Adopting somebody else's version is not an edit of it. A revision here would write their
    // blocks back under this coach's hand for no reason, and move the lineage on for everyone else.
    const revise = await collide(mount())
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    await waitFor(() => {
      expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    })
    expect(revise).toHaveBeenCalledTimes(1)
  })
})
