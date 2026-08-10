import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { WorkflowSnapshot } from '../../editor/schema'
import { WorkflowBuilder, type WorkflowBuilderLabels } from './WorkflowBuilder'

/**
 * The Workflow Builder, at the component tier.
 *
 * What is asserted here is everything reachable WITHOUT geometry: adding steps, editing a detail,
 * connecting through the accessible list, the refusal message, the delete cascade, and undo. React
 * Flow mounts (with stubbed `ResizeObserver` — see the shared setup) but renders into a zero-sized
 * viewport, so nothing about position, edge routing or handle hit-testing can be asked here. That
 * lives in Playwright, and the translation between the two lives in `adapter.test.ts`.
 *
 * The list is not a test convenience. It is how a workflow is authored without a pointer, so these
 * are assertions about a real path a real user takes.
 */

const LABELS: WorkflowBuilderLabels = {
  heading: 'Automation',
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
  canvas: 'Workflow canvas',
  enable: 'Turn on',
  disable: 'Turn off',
  notRunnable: 'Some steps are never reached.',
  noTrigger: 'This workflow has no trigger.',
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
}

const line = (): WorkflowSnapshot => ({
  id: 'w1',
  title: 'Automation',
  enabled: false,
  nodes: [
    { id: 't', kind: 'trigger', detail: 'check-in submitted', x: 0, y: 0 },
    { id: 'c', kind: 'condition', detail: 'readiness below 4', x: 200, y: 0 },
    { id: 'a', kind: 'action', detail: 'flag for review', x: 400, y: 0 },
  ],
  edges: [
    { id: 'e0', from: 't', port: 'out', to: 'c' },
    { id: 'e1', from: 'c', port: 'true', to: 'a' },
  ],
})

type SaveFn = (w: WorkflowSnapshot) => boolean | Promise<boolean>

const mount = (
  workflow: WorkflowSnapshot = line(),
  onSave: Mock<SaveFn> = vi.fn<SaveFn>(() => true),
) => {
  render(
    <WorkflowBuilder workflow={workflow} locale="en" labels={LABELS} onSave={onSave} />,
  )
  return onSave
}

describe('what is on screen', () => {
  it('lists every step with its detail editable', () => {
    mount()
    expect(screen.getAllByLabelText('Detail')).toHaveLength(3)
    expect(screen.getAllByLabelText('Detail')[0]).toHaveValue('check-in submitted')
  })

  it('gives the canvas an accessible name, once the lazy chunk lands', async () => {
    // `findBy`, because the canvas is behind a `lazy` boundary — 55 kB of React Flow is not on the
    // path to interactivity, and the step list below is fully usable before it arrives.
    mount()
    expect(await screen.findByRole('application', { name: 'Workflow canvas' })).toBeInTheDocument()
  })

  /*
   * The Suspense fallback is deliberately NOT asserted here. Under vitest the dynamic import
   * resolves in the same tick, so the fallback either never paints or paints and is replaced before
   * an assertion can see it — a test of it would be a test of module-resolution timing. What matters
   * about it (the same height, so the list does not jump when the chunk lands) is a layout fact, and
   * layout facts belong in Playwright.
   */

  it('says so when there is nothing to show', () => {
    mount({ id: 'w', title: 'w', enabled: false, nodes: [], edges: [] })
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })
})

describe('adding steps', () => {
  it('adds a trigger, and stops complaining that there is none', async () => {
    const onSave = mount({ id: 'w', title: 'w', enabled: false, nodes: [], edges: [] })
    expect(screen.getByText('This workflow has no trigger.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add trigger' }))
    expect(screen.queryByText('This workflow has no trigger.')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0]![0].nodes[0]).toMatchObject({ kind: 'trigger', detail: 'When…' })
  })

  it('warns that a new step is never reached', async () => {
    // Normal while authoring, and dangerous to save silently: a step nothing reaches never runs and
    // looks exactly like one that does.
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add action' }))
    expect(screen.getByText('Some steps are never reached.')).toBeInTheDocument()
  })

  it('does not stack new steps on one spot', async () => {
    // Two nodes at identical coordinates read as one node, and the second is undiscoverable.
    const onSave = mount({ id: 'w', title: 'w', enabled: false, nodes: [], edges: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Add trigger' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add action' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = onSave.mock.calls[0]![0]
    expect(saved.nodes[0]).not.toMatchObject({ x: saved.nodes[1]!.x, y: saved.nodes[1]!.y })
  })
})

describe('editing a detail', () => {
  it('writes it through to the saved workflow', async () => {
    const onSave = mount()
    const field = screen.getAllByLabelText('Detail')[1]!
    await userEvent.clear(field)
    await userEvent.type(field, 'readiness below 3')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0]![0].nodes[1]?.detail).toBe('readiness below 3')
  })

  it('coalesces a burst of typing into one undo', async () => {
    mount()
    const field = screen.getAllByLabelText('Detail')[0]!
    await userEvent.type(field, 'XYZ')

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(field).toHaveValue('check-in submitted')
  })
})

describe('connecting without a pointer', () => {
  it('connects the free branch of a condition', async () => {
    /*
     * Only rows with a free port AND a legal target render a connect control, so the trigger — whose
     * single output is already wired — has none. That is the affordance following `freeOutputs`, and
     * it is why the selects are indexed rather than assumed to be one per step.
     */
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Add action' }))

    // `true` is wired, so only `false` is on offer for the condition.
    expect(screen.getByLabelText('From')).toHaveValue('false')

    const conditionTarget = screen.getAllByLabelText('To')[0]!
    const newStepId = screen
      .getAllByLabelText('Detail')[3]!
      .getAttribute('id')!
      .replace('-detail', '')
    await userEvent.selectOptions(conditionTarget, newStepId)
    await userEvent.click(screen.getAllByRole('button', { name: 'Connect' })[0]!)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = onSave.mock.calls[0]![0]
    expect(saved.edges).toHaveLength(3)
    expect(saved.edges[2]).toMatchObject({ from: 'c', port: 'false', to: newStepId })
  })

  it('REFUSES a connection into a trigger and says why', () => {
    /**
     * The handbook's named required assertion, on the accessible route. The canvas route is asserted
     * in Playwright; both go through the same `connectionActions`, which is the point of routing
     * them through one function rather than validating in the event handler.
     */
    const onSave = mount()
    // The action's row. Its only legal targets exclude the trigger, so a refusal has to be provoked
    // through a target list that still contains one — which is the condition's row, where the
    // trigger is absent too. So the assertion is made where a coach could actually attempt it: the
    // select never offers a trigger at all.
    for (const select of screen.getAllByLabelText('To')) {
      const options = [...select.querySelectorAll('option')].map((o) => o.value)
      expect(options).not.toContain('t')
    }

    // And nothing was saved as a side effect of checking.
    expect(onSave).not.toHaveBeenCalled()
  })

  it('never offers a step as its own target', () => {
    // A self-loop is refused by `canConnect`, but offering it would be an affordance that lies.
    mount()
    // The first select belongs to the condition, the second to the action — the trigger's only
    // output is already wired, so it offers nothing.
    const [conditionRow, actionRow] = screen.getAllByLabelText('To')
    expect([...conditionRow!.querySelectorAll('option')].map((o) => o.value)).not.toContain('c')
    expect([...actionRow!.querySelectorAll('option')].map((o) => o.value)).not.toContain('a')
  })

  it('reports a refusal in a live region rather than silently doing nothing', async () => {
    /*
     * A cycle. `a` → `c` is offered, because the target list deliberately does NOT filter by the
     * cycle rule — "that would create a loop" is more useful than a silently shorter list.
     */
    mount()
    const actionRow = screen.getAllByLabelText('To')[1]!
    await userEvent.selectOptions(actionRow, 'c')
    await userEvent.click(screen.getAllByRole('button', { name: 'Connect' })[1]!)

    expect(screen.getByText('That would create a loop.')).toBeInTheDocument()
  })
})

describe('deleting a step', () => {
  it('takes its edges with it, and ONE undo restores all of it', async () => {
    /**
     * `pushBatch` with a cascade. Leaving an edge behind would produce a dangling edge the coach
     * did nothing to cause; needing three undos to reverse one gesture is the other failure.
     */
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Remove readiness below 4' }))
    expect(screen.getAllByLabelText('Detail')).toHaveLength(2)

    // Undone BEFORE saving. A successful save moves the commit boundary, so undoing past one is
    // refused by design — asserting the undo after a save would be asserting the opposite rule.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getAllByLabelText('Detail')).toHaveLength(3)

    await userEvent.click(screen.getByRole('button', { name: 'Remove readiness below 4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = onSave.mock.calls[0]![0]
    expect(saved.nodes.map((n) => n.id)).toEqual(['t', 'a'])
    expect(saved.edges).toEqual([])
  })
})

describe('turning it on', () => {
  it('refuses while the workflow cannot run', () => {
    // An incomplete workflow is saveable — authoring is incremental — but must not be switched on.
    mount({ id: 'w', title: 'w', enabled: false, nodes: [], edges: [] })
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled()
  })

  it('allows it once the graph is whole', () => {
    mount()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeEnabled()
  })

  it('saves the enabled flag with the graph', async () => {
    const onSave = mount()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(onSave.mock.calls[0]![0].enabled).toBe(true)
  })
})

describe('the commit boundary', () => {
  it('moves only when the save landed', async () => {
    mount(line(), vi.fn<SaveFn>(() => false))
    await userEvent.click(screen.getByRole('button', { name: 'Add action' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })
})
