import { describe, expect, it } from 'vitest'
import { ContractViolationError } from '../http/errors'
import { workflowBodyFrom, workflowFrom } from './workflow'

const ID = (n: number) => `018f2c8a-0000-7000-8000-00000000000${String(n)}`

const wire = () => ({
  id: ID(1),
  title: 'Low readiness',
  enabled: false,
  nodes: [
    { id: ID(2), kind: 'trigger', detail: 'check-in submitted', x: 0, y: 0 },
    { id: ID(3), kind: 'condition', detail: 'readiness below 4', x: 200, y: 0 },
    { id: ID(4), kind: 'action', detail: 'flag for review', x: 400, y: 0 },
  ],
  edges: [
    { id: ID(5), from: ID(2), port: 'out', to: ID(3) },
    { id: ID(6), from: ID(3), port: 'true', to: ID(4) },
  ],
})

describe('reading a workflow', () => {
  it('preserves wire order rather than sorting', () => {
    /**
     * The opposite of every other mapper here, and deliberately. A graph has no order: nodes are
     * identified by id and sequenced by edges. Sorting by anything — `x`, `kind`, id — would impose
     * a meaning the document does not carry, and sorting by `x` in particular would reorder the step
     * list every time a coach dragged a node sideways.
     */
    const workflow = workflowFrom(wire())
    expect(workflow.nodes.map((n) => n.kind)).toEqual(['trigger', 'condition', 'action'])
  })

  it('keeps the port, which is the only thing distinguishing two branches', () => {
    expect(workflowFrom(wire()).edges[1]?.port).toBe('true')
  })

  it('rejects an unknown node kind rather than rendering a blank box', () => {
    // A kind the client does not know cannot be drawn, cannot be validated, and cannot be saved
    // back safely. Tolerating it would put an unlabelled node on a coach's canvas.
    const bad = { ...wire(), nodes: [{ ...wire().nodes[0], kind: 'loop' }] }
    expect(() => workflowFrom(bad)).toThrow(ContractViolationError)
  })

  it('rejects an unknown port', () => {
    const bad = { ...wire(), edges: [{ ...wire().edges[0], port: 'maybe' }] }
    expect(() => workflowFrom(bad)).toThrow(ContractViolationError)
  })

  it('accepts negative coordinates, because a canvas has no origin corner', () => {
    // React Flow's space extends in every direction; a coach who pans and drops a node up-left of
    // the start produces these routinely.
    const w = wire()
    w.nodes[0]!.x = -320
    w.nodes[0]!.y = -80
    expect(workflowFrom(w).nodes[0]).toMatchObject({ x: -320, y: -80 })
  })
})

describe('writing a workflow', () => {
  it('round-trips', () => {
    const workflow = workflowFrom(wire())
    expect(workflowFrom(workflowBodyFrom(workflow))).toEqual(workflow)
  })

  it('validates on the way OUT too', () => {
    const workflow = workflowFrom(wire())
    const broken = { ...workflow, title: '' }
    expect(() => workflowBodyFrom(broken)).toThrow(ContractViolationError)
  })

  it('sends an empty graph without complaint', () => {
    // A workflow with no steps is authorable — a coach who deletes everything has one — and it is
    // simply not enableable. Refusing to SAVE it would lose their work.
    const workflow = workflowFrom({ ...wire(), nodes: [], edges: [] })
    expect(workflowBodyFrom(workflow).nodes).toEqual([])
  })
})
