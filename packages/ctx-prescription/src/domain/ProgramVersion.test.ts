import { isErr, unwrapOrThrow, type ProgramId, type ProgramVersionId } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { progressionIntent } from './ProgressionIntent'
import { servesGoal } from './ServesGoal'
import {
  programVersion,
  revise,
  type AuthoringDecision,
  type Block,
  type ProgramVersion,
  type ProgramVersionInput,
} from './ProgramVersion'

const fixed = unwrapOrThrow(progressionIntent('fixed', null), () => new Error('fixture'))

const block = (id: string, order: number, name = `Block ${id}`): Block => ({
  id,
  name,
  order,
  progressionIntent: fixed,
})

const DECISION: AuthoringDecision = {
  decidedBy: 'coach-1',
  proposedBy: 'human',
  rationale: 'base strength phase',
}

const base: ProgramVersionInput = {
  id: 'pv-1' as ProgramVersionId,
  programId: 'p-1' as ProgramId,
  versionNumber: 1,
  blocks: [block('b1', 0), block('b2', 1)],
  servesGoal: null,
  authoringDecision: DECISION,
}

const make = (over: Partial<ProgramVersionInput> = {}): ProgramVersion =>
  unwrapOrThrow(programVersion({ ...base, ...over }), (e) => new Error(JSON.stringify(e)))

describe('programVersion — version numbering', () => {
  it('accepts version 1', () => {
    expect(make().versionNumber).toBe(1)
  })

  it('rejects version 0, which is what an uninitialised counter produces', () => {
    const result = programVersion({ ...base, versionNumber: 0 })
    expect(isErr(result) && result.error.kind).toBe('version-not-positive')
  })

  it('rejects a negative or fractional version', () => {
    expect(isErr(programVersion({ ...base, versionNumber: -1 }))).toBe(true)
    expect(isErr(programVersion({ ...base, versionNumber: 1.5 }))).toBe(true)
  })
})

describe('programVersion — blocks', () => {
  it('rejects an empty block list', () => {
    // The state a half-finished builder session would save. Every consumer downstream would
    // have to special-case it.
    const result = programVersion({ ...base, blocks: [] })
    expect(isErr(result) && result.error.kind).toBe('no-blocks')
  })

  it('rejects duplicate block ids', () => {
    const result = programVersion({ ...base, blocks: [block('b1', 0), block('b1', 1)] })
    expect(isErr(result) && result.error.kind).toBe('duplicate-block-id')
  })

  it('rejects a blank block name', () => {
    const result = programVersion({ ...base, blocks: [block('b1', 0, '   ')] })
    expect(isErr(result) && result.error.kind).toBe('block-name-empty')
  })

  it('rejects a GAP in block order', () => {
    // The bug a drag-reorder produces: writing back `order` for only the moved block. It
    // does not throw — the list just renders in an order nobody chose, and differently
    // depending on whether the consumer sorted stably.
    const result = programVersion({ ...base, blocks: [block('b1', 0), block('b2', 2)] })
    expect(isErr(result) && result.error.kind).toBe('block-order-not-contiguous')
  })

  it('rejects a DUPLICATE order', () => {
    const result = programVersion({ ...base, blocks: [block('b1', 0), block('b2', 0)] })
    expect(isErr(result) && result.error.kind).toBe('block-order-not-contiguous')
  })

  it('sorts blocks into one canonical order', () => {
    // Consumers must not each decide. Two clients rendering the same version in different
    // orders is indistinguishable from a data bug.
    const out = make({ blocks: [block('b2', 1), block('b1', 0)] })
    expect(out.blocks.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('freezes the block list at runtime, not just in the types', () => {
    // `readonly` is erased at compile time and stops nothing. This is what makes the
    // immutability claim true for JavaScript callers.
    const out = make()
    expect(Object.isFrozen(out.blocks)).toBe(true)
  })
})

describe('revise — a new version, never a mutation', () => {
  it('increments the version number', () => {
    const v1 = make()
    const v2 = unwrapOrThrow(
      revise(v1, {
        id: 'pv-2' as ProgramVersionId,
        blocks: [block('b1', 0)],
        authoringDecision: DECISION,
      }),
      (e) => new Error(JSON.stringify(e)),
    )
    expect(v2.versionNumber).toBe(2)
  })

  it('leaves the original completely untouched', () => {
    // The reason this is a constructor and not a mutator: a PerformedSession records what an
    // athlete did against a specific structure. If the structure could change afterwards,
    // you could no longer tell whether they under-performed or the target moved.
    const v1 = make()
    const before = JSON.stringify(v1.blocks)

    revise(v1, {
      id: 'pv-2' as ProgramVersionId,
      blocks: [block('z9', 0)],
      authoringDecision: DECISION,
    })

    expect(JSON.stringify(v1.blocks)).toBe(before)
    expect(v1.versionNumber).toBe(1)
  })

  it('carries the lineage across', () => {
    const v1 = make()
    const v2 = unwrapOrThrow(
      revise(v1, {
        id: 'pv-2' as ProgramVersionId,
        blocks: [block('b1', 0)],
        authoringDecision: DECISION,
      }),
      () => new Error('fixture'),
    )
    expect(v2.programId).toBe(v1.programId)
  })

  it('requires a fresh authoring decision rather than inheriting one', () => {
    // A revision is a new decision by a person. Inheriting would attribute this change to
    // whoever made the last one — exactly the audit trail ADR-0003 exists to keep.
    const v1 = make()
    const v2 = unwrapOrThrow(
      revise(v1, {
        id: 'pv-2' as ProgramVersionId,
        blocks: [block('b1', 0)],
        authoringDecision: { decidedBy: 'coach-2', proposedBy: 'assistant', rationale: 'ai' },
      }),
      () => new Error('fixture'),
    )
    expect(v2.authoringDecision.decidedBy).toBe('coach-2')
    expect(v2.authoringDecision.proposedBy).toBe('assistant')
  })

  it('distinguishes "unchanged purpose" from "no longer serves a goal"', () => {
    // `undefined` means unchanged; explicit `null` means retired. A `??` would collapse
    // them, and the collapse silently resurrects a purpose the author just removed.
    const withGoal = make({ servesGoal: servesGoal('g-1' as never, 'why') })

    const unchanged = unwrapOrThrow(
      revise(withGoal, {
        id: 'pv-2' as ProgramVersionId,
        blocks: [block('b1', 0)],
        authoringDecision: DECISION,
      }),
      () => new Error('fixture'),
    )
    expect(unchanged.servesGoal?.goalId).toBe('g-1')

    const retired = unwrapOrThrow(
      revise(withGoal, {
        id: 'pv-2' as ProgramVersionId,
        blocks: [block('b1', 0)],
        servesGoal: null,
        authoringDecision: DECISION,
      }),
      () => new Error('fixture'),
    )
    expect(retired.servesGoal).toBeNull()
  })

  it('applies the same invariants to the revision', () => {
    const v1 = make()
    expect(
      isErr(revise(v1, { id: 'pv-2' as ProgramVersionId, blocks: [], authoringDecision: DECISION })),
    ).toBe(true)
  })
})

describe('ADR-0008 — ServesGoal is never an evaluation input', () => {
  it('exposes no function that judges success from servesGoal', () => {
    // A guard on intent rather than behaviour. If a `didAchieveGoal`-shaped export appears
    // here, ADR-0008 has been broken and the fix is to delete it. Evaluation belongs to the
    // Hypothesis on the authoring record (ADR-0007) and DecisionOutcome in Learning.
    const version = make({ servesGoal: servesGoal('g-1' as never) })
    const surface = Object.keys(version).join(' ').toLowerCase()
    for (const forbidden of ['achieved', 'success', 'outcome', 'verdict', 'progress']) {
      expect(surface).not.toContain(forbidden)
    }
  })
})
