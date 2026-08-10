import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applyAction, type NodeId } from '@fitnessos/editor-engine'
import type { ProgramVersionSnapshot } from '../application/index'
import { HYDRATE_COVERAGE, commit, hydrate, normalize } from './schema'

/**
 * D-09 — the draft ↔ snapshot round trip.
 *
 * The failure being guarded against is silent data loss on save: hydrate drops a field, the user
 * edits something unrelated, commit writes back, and the field is gone. The user did nothing wrong
 * and the system reported success.
 */

const arbBlock = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  order: fc.integer({ min: 0, max: 50 }),
  progression: fc.oneof(
    fc.record({ kind: fc.constant('fixed' as const), ratePercent: fc.constant(null) }),
    fc.record({ kind: fc.constant('autoregulated' as const), ratePercent: fc.constant(null) }),
    fc.record({
      kind: fc.constant('linear' as const),
      ratePercent: fc.double({ min: 0.5, max: 20, noNaN: true }),
    }),
  ),
})

const arbVersion: fc.Arbitrary<ProgramVersionSnapshot> = fc
  .record({
    id: fc.uuid(),
    programId: fc.uuid(),
    versionNumber: fc.integer({ min: 1, max: 500 }),
    blocks: fc.uniqueArray(arbBlock, { minLength: 1, maxLength: 8, selector: (b) => b.id }),
    servesGoal: fc.option(
      fc.record({ goalId: fc.uuid(), rationale: fc.option(fc.string(), { nil: null }) }),
      { nil: null },
    ),
    authoredBy: fc.record({
      decidedBy: fc.string({ minLength: 1 }),
      proposedBy: fc.constantFrom('human' as const, 'assistant' as const),
    }),
  })
  .map((v) => v as unknown as ProgramVersionSnapshot)

describe('round trip', () => {
  it('commit(hydrate(x)) preserves the programme', () => {
    // The core D-09 property. Blocks arrive with arbitrary `order` values, so both sides are
    // normalised — order is DERIVED on commit and is the one field a round trip may change.
    fc.assert(
      fc.property(arbVersion, (version) => {
        expect(normalize(commit(hydrate(version)))).toEqual(normalize(version))
      }),
      { numRuns: 400 },
    )
  })

  it('preserves servesGoal, which the builder never edits', () => {
    // The specific loss this guards: an editor that dropped `servesGoal` would erase a coach's
    // stated purpose the first time anyone renamed a block.
    fc.assert(
      fc.property(arbVersion, (version) => {
        expect(commit(hydrate(version)).servesGoal).toEqual(version.servesGoal)
      }),
      { numRuns: 200 },
    )
  })

  it('preserves the authoring decision', () => {
    fc.assert(
      fc.property(arbVersion, (version) => {
        expect(commit(hydrate(version)).authoredBy).toEqual(version.authoredBy)
      }),
      { numRuns: 200 },
    )
  })

  it('survives an edit in between', () => {
    // Round-tripping an untouched draft is the easy case. This is the real one: hydrate, edit,
    // commit — and everything the edit did not touch must still be there.
    fc.assert(
      fc.property(arbVersion, fc.string({ minLength: 1, maxLength: 20 }), (version, newName) => {
        const draft = hydrate(version)
        const first = draft.document.rootIds[0]
        if (first === undefined) return

        const edited = {
          ...draft,
          document: applyAction(draft.document, {
            type: 'SetProperty',
            nodeId: first,
            key: 'name',
            value: newName,
          }),
        }

        const result = commit(edited)
        expect(result.blocks[0]?.name).toBe(newName)
        expect(result.servesGoal).toEqual(version.servesGoal)
        expect(result.versionNumber).toBe(version.versionNumber)
        expect(result.blocks).toHaveLength(version.blocks.length)
      }),
      { numRuns: 200 },
    )
  })
})

describe('order is derived, never carried', () => {
  it('commit always produces contiguous orders from 0', () => {
    // The document's rootIds ARE the order, so the aggregate's "orders must be exactly 0..n-1"
    // invariant cannot be violated by the editor. Carrying a separate `order` field would give the
    // same fact two homes, and they would disagree the first time a drag updated one.
    fc.assert(
      fc.property(arbVersion, (version) => {
        const orders = commit(hydrate(version)).blocks.map((b) => b.order)
        expect(orders).toEqual(orders.map((_, index) => index))
      }),
      { numRuns: 200 },
    )
  })

  it('reordering nodes reorders the committed blocks', () => {
    const version = {
      id: 'v1',
      programId: 'p1',
      versionNumber: 1,
      blocks: [
        { id: 'b1', name: 'first', order: 0, progression: { kind: 'fixed', ratePercent: null } },
        { id: 'b2', name: 'second', order: 1, progression: { kind: 'fixed', ratePercent: null } },
      ],
      servesGoal: null,
      authoredBy: { decidedBy: 'coach', proposedBy: 'human' },
    } as unknown as ProgramVersionSnapshot

    const draft = hydrate(version)
    const moved = {
      ...draft,
      document: applyAction(draft.document, {
        type: 'MoveNodes',
        nodeIds: ['b2' as NodeId],
        toParentId: null,
        toIndex: 0,
      }),
    }

    expect(commit(moved).blocks.map((b) => b.name)).toEqual(['second', 'first'])
    expect(commit(moved).blocks.map((b) => b.order)).toEqual([0, 1])
  })
})

describe('coverage', () => {
  it('accounts for every field of the snapshot', () => {
    // The compile-time half is the map's type. This asserts the runtime half — that no key was
    // added to the type and then given a value here without being mapped.
    const version = {
      id: 'v', programId: 'p', versionNumber: 1,
      blocks: [{ id: 'b', name: 'n', order: 0, progression: { kind: 'fixed', ratePercent: null } }],
      servesGoal: null,
      authoredBy: { decidedBy: 'c', proposedBy: 'human' },
    } as unknown as ProgramVersionSnapshot

    expect(Object.keys(HYDRATE_COVERAGE).sort()).toEqual(Object.keys(version).sort())
  })
})
