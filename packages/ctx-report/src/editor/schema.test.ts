import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isOk } from '@fitnessos/kernel'
import {
  DEFAULT_HISTORY_CONFIG,
  canUndo,
  createHistory,
  push,
  undo,
  type NodeId,
} from '@fitnessos/editor-engine'
import { MIN_TILE_SIZE, report, type Tile, type TileContent } from '../domain/Report'
import { HYDRATE_COVERAGE, commit, hydrate, normalize, rectOfNode, type ReportSnapshot } from './schema'

const arbText = fc.string({ minLength: 1 }).filter((s) => s.trim() !== '')

const arbContent: fc.Arbitrary<TileContent> = fc.oneof(
  fc.record({ kind: fc.constant('note' as const), text: fc.string() }),
  fc.record({
    kind: fc.constant('indicator' as const),
    indicatorKind: fc.constantFrom('bodyweight', 'estimated-1rm'),
    fallbackLabel: arbText,
  }),
)

const arbTile = (index: number): fc.Arbitrary<Tile> =>
  fc.record({
    id: fc.constant(`t${String(index)}`),
    x: fc.integer({ min: -500, max: 1500 }),
    y: fc.integer({ min: -500, max: 1500 }),
    width: fc.integer({ min: MIN_TILE_SIZE, max: 600 }),
    height: fc.integer({ min: MIN_TILE_SIZE, max: 400 }),
    content: arbContent,
  })

const arbReport: fc.Arbitrary<ReportSnapshot> = fc
  .integer({ min: 0, max: 4 })
  .chain((count) =>
    fc.record({
      id: fc.constant('report-1'),
      title: arbText,
      tiles: fc.tuple(...Array.from({ length: count }, (_, i) => arbTile(i))),
    }),
  )

describe('the round trip', () => {
  it('commit(hydrate(x)) preserves the report exactly', () => {
    // Exactly, with no normalisation: a report has no derived field. Unlike a programme, whose
    // `order` is recomputed from position, every number here is one the coach placed.
    fc.assert(
      fc.property(arbReport, (snapshot) => {
        expect(normalize(commit(hydrate(snapshot)))).toEqual(normalize(snapshot))
      }),
      { numRuns: 200 },
    )
  })

  it('preserves paint order rather than sorting', () => {
    /**
     * `rootIds` carries a different fact here than in the tree editors. In a programme it is the
     * sequence an athlete follows; in a report it is which tile draws on top. Sorting on hydrate
     * — which is exactly what the programme schema does — would silently change the arrangement.
     */
    const snapshot: ReportSnapshot = {
      id: 'r',
      title: 'T',
      tiles: [
        { id: 'zzz', x: 300, y: 0, width: 100, height: 100, content: { kind: 'note', text: '' } },
        { id: 'aaa', x: 0, y: 0, width: 100, height: 100, content: { kind: 'note', text: '' } },
      ],
    }
    expect(commit(hydrate(snapshot)).tiles.map((t) => t.id)).toEqual(['zzz', 'aaa'])
  })

  it('produces a report the domain accepts', () => {
    fc.assert(
      fc.property(arbReport, (snapshot) => {
        expect(isOk(report(commit(hydrate(snapshot))))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('accounts for every field of the snapshot', () => {
    expect(Object.keys(HYDRATE_COVERAGE).sort()).toEqual(['id', 'tiles', 'title'])
  })
})

describe('the tile rect is derived, never stored twice', () => {
  it('reads position and size from the node’s props', () => {
    const draft = hydrate({
      id: 'r',
      title: 'T',
      tiles: [{ id: 'a', x: 10, y: 20, width: 100, height: 50, content: { kind: 'note', text: '' } }],
    })
    expect(rectOfNode(draft.document.nodes['a' as NodeId]!.props)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    })
  })

  it('falls back rather than producing NaN from an unreadable prop', () => {
    // NaN is what a coordinate conversion produces when it goes wrong, and it propagates
    // silently: the tile vanishes from the canvas and every hit test misses it.
    expect(rectOfNode({ x: 'nonsense', y: Number.NaN }).x).toBe(0)
    expect(rectOfNode({ x: 'nonsense', y: Number.NaN }).y).toBe(0)
  })
})

describe('a drag is ONE undo entry, for free', () => {
  it('coalesces the x and y writes of a single move', () => {
    /**
     * The property this builder depends on rather than merely enjoys, so it is asserted here.
     *
     * A spatial move changes two numbers on one node. `shouldCoalesce` requires the same action
     * type and the same targets — which `x` and `y` on one tile satisfy — so two `SetProperty`
     * dispatches merge into one entry with no special case anywhere. Without it, undoing a drag
     * would restore the x and leave the y, and the tile would end up somewhere the user never
     * put it.
     */
    const draft = hydrate({
      id: 'r',
      title: 'T',
      tiles: [{ id: 'a', x: 0, y: 0, width: 100, height: 100, content: { kind: 'note', text: '' } }],
    })

    let history = createHistory(draft.document, DEFAULT_HISTORY_CONFIG)
    history = push(
      history,
      { type: 'SetProperty', nodeId: 'a' as NodeId, key: 'x', value: 300 },
      { label: 'move', at: 1000, id: 'e1' },
    )
    history = push(
      history,
      { type: 'SetProperty', nodeId: 'a' as NodeId, key: 'y', value: 400 },
      { label: 'move', at: 1010, id: 'e2' },
    )

    expect(history.entries).toHaveLength(1)

    history = undo(history)
    const props = history.document.nodes['a' as NodeId]?.props
    // BOTH restored. The inverses are prepended when coalescing, which is what makes the newest
    // write unwind first.
    expect(props?.['x']).toBe(0)
    expect(props?.['y']).toBe(0)
    expect(canUndo(history)).toBe(false)
  })
})
