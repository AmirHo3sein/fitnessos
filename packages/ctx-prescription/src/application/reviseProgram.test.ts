import { describe, expect, it, vi, type Mock } from 'vitest'
import type {
  BlockSnapshot,
  PrescriptionPorts,
  ProgramSnapshot,
  ProgramVersionSnapshot,
} from './ports/index'
import { ProgramValidationError, reviseProgram } from './reviseProgram'

const block = (over: Partial<BlockSnapshot> = {}): BlockSnapshot => ({
  id: 'b1',
  name: 'Preparation',
  order: 0,
  progression: { kind: 'fixed', ratePercent: null },
  ...over,
})

const version = (over: Partial<ProgramVersionSnapshot> = {}): ProgramVersionSnapshot =>
  ({
    id: 'v1',
    programId: 'p1',
    versionNumber: 3,
    blocks: [block()],
    servesGoal: null,
    authoredBy: { decidedBy: 'coach-1', proposedBy: 'human' },
    ...over,
  }) as unknown as ProgramVersionSnapshot

type ReviseFn = PrescriptionPorts['prescription']['revise']

/**
 * Typed against the port rather than cast through `any`, so `sent()` below is checked: an
 * assertion on a field the port does not have is a compile error, not a passing test.
 */
const ports = (revise: Mock<ReviseFn> = vi.fn<ReviseFn>(() => Promise.resolve(program()))) => ({
  ports: {
    prescription: { currentProgram: vi.fn(), revise },
    // Unused here, and still required — `satisfies` will not let a fixture drift from the port.
    references: { resolve: () => Promise.resolve(new Map()) },
  } satisfies PrescriptionPorts,
  revise,
})

const program = (): ProgramSnapshot =>
  ({ id: 'p1', athleteId: 'a1', title: 'Base', currentVersion: version() }) as ProgramSnapshot

const sent = (p: ReturnType<typeof ports>) => p.revise.mock.calls[0]![0]

describe('what gets sent', () => {
  it('generates a NEW id for the version rather than reusing the edited one', async () => {
    // Reusing the edited version's id would read to the server as a replay of something it has
    // already stored, and the revision would be silently discarded with a 200.
    const p = ports()
    await reviseProgram(p.ports, version(), version())
    expect(sent(p).id).not.toBe('v1')
    expect(sent(p).baseVersionId).toBe('v1')
  })

  it('does not send a version number', async () => {
    // It belongs to the lineage. A client that guessed it would race another author.
    const p = ports()
    await reviseProgram(p.ports, version(), version())
    expect(sent(p)).not.toHaveProperty('versionNumber')
  })

  it('sends the domain’s sorted blocks, not the order the editor held', async () => {
    const p = ports()
    const next = version({
      blocks: [block({ id: 'b2', name: 'Second', order: 1 }), block({ id: 'b1', order: 0 })],
    })
    await reviseProgram(p.ports, version(), next)
    expect(sent(p).blocks.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('carries servesGoal and authorship through', async () => {
    const p = ports()
    const next = version({
      servesGoal: { goalId: 'g1', rationale: 'base phase' },
    } as Partial<ProgramVersionSnapshot>)
    await reviseProgram(p.ports, version(), next)
    expect(sent(p).servesGoal).toEqual({ goalId: 'g1', rationale: 'base phase' })
    expect(sent(p).authoredBy.decidedBy).toBe('coach-1')
  })
})

describe('validation', () => {
  const rejects = async (next: ProgramVersionSnapshot, kind: string) => {
    const p = ports()
    await expect(reviseProgram(p.ports, version(), next)).rejects.toBeInstanceOf(ProgramValidationError)
    await expect(reviseProgram(p.ports, version(), next)).rejects.toMatchObject({ problem: { kind } })
    expect(p.revise).not.toHaveBeenCalled()
  }

  it('refuses an empty programme', async () => {
    await rejects(version({ blocks: [] }), 'no-blocks')
  })

  it('refuses duplicate block orders', async () => {
    await rejects(
      version({ blocks: [block({ id: 'b1', order: 0 }), block({ id: 'b2', order: 0 })] }),
      'block-order-not-contiguous',
    )
  })

  it('refuses a blank block name', async () => {
    await rejects(version({ blocks: [block({ name: '   ' })] }), 'block-name-empty')
  })

  it('refuses a rate on a fixed block, naming the block', async () => {
    // The builder clears the rate when the kind changes; this is what makes that a guarantee
    // rather than a habit of one component. A second builder gets the same check.
    const p = ports()
    const next = version({ blocks: [block({ progression: { kind: 'fixed', ratePercent: 2.5 } })] })
    await expect(reviseProgram(p.ports, version(), next)).rejects.toMatchObject({
      problem: { kind: 'block-progression-invalid', blockId: 'b1' },
    })
  })

  it('refuses a linear block with no rate', async () => {
    const p = ports()
    const next = version({ blocks: [block({ progression: { kind: 'linear', ratePercent: null } })] })
    await expect(reviseProgram(p.ports, version(), next)).rejects.toMatchObject({
      problem: { kind: 'block-progression-invalid' },
    })
  })
})

describe('the tolerant-reader case', () => {
  it('lets a coach fix a CURRENT version that would fail validation', async () => {
    /**
     * The read model accepts programmes written before a rule existed. If revising validated the
     * current version as well as the proposed one, a legacy programme with duplicate block orders
     * would be permanently uneditable — by the only tool that could fix it.
     */
    const broken = version({
      blocks: [block({ id: 'b1', order: 5 }), block({ id: 'b2', name: '', order: 5 })],
    })
    const p = ports()
    await expect(reviseProgram(p.ports, broken, version())).resolves.toBeDefined()
    expect(p.revise).toHaveBeenCalled()
  })
})
