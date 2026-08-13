import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SubjectProvider } from '@fitnessos/ui'
import type { SubjectId } from '@fitnessos/kernel'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { WorkflowConflictError, type Loaded, type WorkflowPorts } from '../../application/index'
import type { WorkflowSnapshot } from '../../editor/schema'
import { WorkflowPortsProvider } from '../di'
import { WorkflowWorkspace, type WorkflowWorkspaceLabels } from './WorkflowWorkspace'

/**
 * Component tier: a collision, from the port that reports it to the choice the author makes.
 *
 * The interesting half is not that a card appears. It is what each choice SENDS — a "keep mine" that
 * re-sends the document onto the revision this client read is indistinguishable on screen from one
 * that sends it onto the server's, and only the second ever lands. So every assertion here is about
 * the arguments the write port received, not only about what is on the page.
 *
 * The canvas is left to its own devices, as in `WorkflowBuilder.test.tsx`: React Flow mounts into a
 * zero-sized viewport and nothing geometric can be asked of it here. The step list is the route a
 * coach without a pointer takes anyway, so it is what a step is identified by below.
 */

const LABELS: WorkflowWorkspaceLabels = {
  title: 'Automation',
  none: 'No automation yet',
  noneHint: 'You can say what should happen when something happens.',
  create: 'Create an automation',
  loading: 'Loading the automation',
  loadFailed: 'The automation could not be loaded.',
  retry: 'Try again',
  saveFailed: 'Your changes were not saved.',
  conflictTitle: 'This automation was changed elsewhere',
  conflictBody: 'Someone else saved a new version while you were editing.',
  conflictKeep: 'Keep mine and save again',
  conflictDiscard: 'Discard mine and use theirs',
  conflictDismiss: 'Decide later',
  newTitle: 'Automation',
  firstTrigger: 'check-in submitted',
  builder: {
    heading: 'Steps and connections',
    addTrigger: 'Add trigger',
    addCondition: 'Add condition',
    addAction: 'Add action',
    removeStep: 'Remove',
    undo: 'Undo',
    redo: 'Redo',
    save: 'Save',
    detail: 'Detail',
    connectFrom: 'From',
    connectTo: 'To',
    connect: 'Connect',
    disconnect: 'Disconnect',
    empty: 'Nothing here yet.',
    newTrigger: 'When…',
    newCondition: 'If…',
    newAction: 'Then…',
    steps: 'Steps',
    canvas: 'Automation canvas',
    enable: 'Turn on',
    disable: 'Turn off',
    notRunnable: 'Some steps are never reached.',
    noTrigger: 'This automation has no trigger.',
    node: {
      trigger: 'Trigger',
      condition: 'Condition',
      action: 'Action',
      branchTrue: 'yes',
      branchFalse: 'no',
      unreachable: 'never reached',
    },
    refusal: {
      'missing-node': 'That step is gone.',
      'unknown-port': 'That is not an output of this step.',
      'trigger-input': 'Nothing can lead into a trigger.',
      'self-loop': 'A step cannot follow itself.',
      cycle: 'That would create a loop.',
      'port-taken': 'That branch already leads somewhere.',
      duplicate: 'Those are already connected.',
    },
  },
}

const mine = (): WorkflowSnapshot => ({
  id: 'w1',
  title: 'Automation',
  enabled: false,
  nodes: [{ id: 'mine-trigger', kind: 'trigger', detail: 'check-in submitted', x: 0, y: 0 }],
  edges: [],
})

/** The same workflow id — a collision is two authors on ONE artefact, not two artefacts. */
const theirs = (): WorkflowSnapshot => ({
  id: 'w1',
  title: 'Automation',
  enabled: false,
  nodes: [{ id: 'their-trigger', kind: 'trigger', detail: 'weight logged', x: 0, y: 0 }],
  edges: [],
})

/** The revision the server holds, which is NOT the one this client read. */
const SERVER_REVISION = 9
const READ_REVISION = 4

type SaveFn = WorkflowPorts['workflow']['save']

const mount = (save: Mock<SaveFn>) => {
  const ports: WorkflowPorts = {
    workflow: {
      current: () =>
        Promise.resolve<Loaded<WorkflowSnapshot>>({ artefact: mine(), revision: READ_REVISION }),
      save,
    },
  }
  // retry: false, or a rejecting save waits out the backoff before the card appears.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <SubjectProvider value={'a-1' as SubjectId}>
        <WorkflowPortsProvider value={ports}>
          <WorkflowWorkspace locale="en" labels={LABELS} />
        </WorkflowPortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )
  return save
}

/** A save that collides once, then accepts whatever comes next. */
const collidesOnce = (): Mock<SaveFn> => {
  let collided = false
  return vi.fn<SaveFn>((workflow, baseRevision) => {
    if (collided) return Promise.resolve({ artefact: workflow, revision: (baseRevision ?? 0) + 1 })
    collided = true
    return Promise.reject(
      new WorkflowConflictError({ artefact: theirs(), revision: SERVER_REVISION }),
    )
  })
}

const collide = async (save: Mock<SaveFn>) => {
  mount(save)
  await screen.findByTestId('row-mine-trigger')
  await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
  await screen.findByText(LABELS.conflictTitle)
}

describe('a save that collided', () => {
  it('offers the choice instead of the generic failure banner', async () => {
    /*
     * Nothing broke — someone else got there first — so "your changes were not saved, try again" is
     * both true and useless: trying again is exactly what cannot work. That banner used to be ALL
     * the author got, which is the state this replaces.
     */
    await collide(collidesOnce())

    expect(screen.getByText(LABELS.conflictBody)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.saveFailed)).not.toBeInTheDocument()
  })

  it("keeps the author's own steps on screen", async () => {
    // The local document is never swapped out from under an author mid-decision: it is half of what
    // they are being asked to choose between.
    await collide(collidesOnce())

    expect(screen.getByTestId('row-mine-trigger')).toBeInTheDocument()
    expect(screen.queryByTestId('row-their-trigger')).not.toBeInTheDocument()
  })

  it('can be dismissed without choosing, and leaves the document alone', async () => {
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDismiss }))

    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    expect(screen.getByTestId('row-mine-trigger')).toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('keep mine', () => {
  it("re-saves the author's document onto the revision the SERVER named", async () => {
    /*
     * The whole point. A retry quoting the revision this client read would 409 for exactly the same
     * reason, for ever — the collision visible, and still unresolvable.
     */
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))

    expect(save).toHaveBeenCalledTimes(2)
    const [workflow, baseRevision] = save.mock.calls[1]!
    expect(baseRevision).toBe(SERVER_REVISION)
    expect(workflow.nodes.map((node) => node.id)).toEqual(['mine-trigger'])
  })

  it('carries the edits made before the collision, not the last loaded workflow', async () => {
    // "Mine" is what the author pressed Save with. Re-reading the cache would send the document they
    // started from and quietly drop the work the collision was meant to protect.
    const save = collidesOnce()
    mount(save)
    await screen.findByTestId('row-mine-trigger')
    await userEvent.click(screen.getByRole('button', { name: LABELS.builder.addAction }))
    await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
    await screen.findByText(LABELS.conflictTitle)

    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictKeep }))
    expect(save.mock.calls[1]![0].nodes).toHaveLength(2)
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

    // Remounted, because the workflow id does not change when the document behind it does — without
    // that the editor would still be showing the draft the author just gave up.
    expect(await screen.findByTestId('row-their-trigger')).toBeInTheDocument()
    expect(screen.queryByTestId('row-mine-trigger')).not.toBeInTheDocument()
    expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
  })

  it('writes nothing: adopting is a local decision until the next edit', async () => {
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))

    expect(save).toHaveBeenCalledTimes(1)
  })

  it("leaves the next save asserting the SERVER's revision", async () => {
    // The envelope is adopted, not the document alone. Keeping the revision this client read would
    // make the very next save collide again, over a conflict the author has already settled.
    const save = collidesOnce()
    await collide(save)
    await userEvent.click(screen.getByRole('button', { name: LABELS.conflictDiscard }))
    await screen.findByTestId('row-their-trigger')

    await userEvent.click(screen.getByRole('button', { name: LABELS.builder.save }))
    expect(save.mock.calls[1]![1]).toBe(SERVER_REVISION)
  })
})
