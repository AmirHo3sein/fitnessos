import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isOk } from '@fitnessos/kernel'
import { documentRect, type NodeId } from '@fitnessos/editor-engine'
import { dashboard, type Widget, type WidgetContent } from '../domain/Dashboard'
import {
  HYDRATE_COVERAGE,
  commit,
  compactionFor,
  hydrate,
  movesFor,
  normalize,
  type DashboardSnapshot,
} from './schema'

const COLUMNS = 12
const arbText = fc.string({ minLength: 1 }).filter((s) => s.trim() !== '')

const arbContent: fc.Arbitrary<WidgetContent> = fc.oneof(
  fc.constant({ kind: 'upcoming-sessions' } as const),
  fc.constant({ kind: 'unjudged-proposals' } as const),
  fc.record({
    kind: fc.constant('indicator' as const),
    indicatorKind: fc.constantFrom('bodyweight', 'estimated-1rm'),
    fallbackLabel: arbText,
  }),
)

/** Widgets stacked in a column, so the arbitrary never generates an overlap the domain rejects. */
const arbDashboard: fc.Arbitrary<DashboardSnapshot> = fc
  .array(fc.record({ width: fc.integer({ min: 1, max: 12 }), height: fc.integer({ min: 1, max: 4 }), content: arbContent }), {
    maxLength: 5,
  })
  .chain((specs) =>
    fc.record({
      id: fc.constant('d1'),
      title: arbText,
      columns: fc.constant(COLUMNS),
      widgets: fc.constant(
        specs.reduce<Widget[]>((acc, spec, i) => {
          const y = acc.reduce((total, w) => total + w.height, 0)
          acc.push({ id: `w${String(i)}`, x: 0, y, width: spec.width, height: spec.height, content: spec.content })
          return acc
        }, []),
      ),
    }),
  )

const widget = (id: string, x: number, y: number, w = 3, h = 2): Widget => ({
  id,
  x,
  y,
  width: w,
  height: h,
  content: { kind: 'upcoming-sessions' },
})

const snapshot = (widgets: Widget[]): DashboardSnapshot => ({
  id: 'd1',
  title: 'Overview',
  columns: COLUMNS,
  widgets,
})

describe('the round trip', () => {
  it('commit(hydrate(x)) preserves the dashboard exactly', () => {
    fc.assert(
      fc.property(arbDashboard, (d) => {
        expect(normalize(commit(hydrate(d)))).toEqual(normalize(d))
      }),
      { numRuns: 200 },
    )
  })

  it('produces a dashboard the domain accepts', () => {
    fc.assert(
      fc.property(arbDashboard, (d) => {
        expect(isOk(dashboard(commit(hydrate(d))))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('accounts for every field of the snapshot', () => {
    expect(Object.keys(HYDRATE_COVERAGE).sort()).toEqual(['columns', 'id', 'title', 'widgets'])
  })

  it('clamps an off-grid rect on the way out', () => {
    // A builder cannot produce one; a hand-edited or migrated document can, and committing it
    // unchanged would hand the aggregate something it refuses.
    const draft = hydrate(snapshot([widget('a', 0, 0)]))
    const wide = {
      ...draft,
      document: {
        ...draft.document,
        nodes: {
          ...draft.document.nodes,
          a: {
            ...draft.document.nodes['a' as NodeId]!,
            // Spread, so the content props survive. Replacing them wholesale made the widget an
            // indicator charting nothing, and the aggregate refused it for a reason that had
            // nothing to do with the clamp under test.
            props: { ...draft.document.nodes['a' as NodeId]!.props, x: 30, y: 0, width: 40, height: 2 },
          },
        },
      },
    }
    const committed = commit(wide).widgets[0]
    expect(committed).toMatchObject({ x: 0, width: COLUMNS })
    expect(isOk(dashboard(commit(wide)))).toBe(true)
  })
})

describe('a move rearranges the grid around the dropped widget', () => {
  it('returns the displaced widget as well as the moved one', () => {
    /**
     * The difference from the report canvas, where a drag is two `SetProperty` calls on one
     * node. Here dropping onto an occupied cell has to displace what was there, so the gesture
     * produces several nodes' worth of change — and therefore one BATCH, so one undo restores
     * all of them.
     */
    const draft = hydrate(snapshot([widget('a', 0, 0), widget('dragged', 0, 4)]))
    const moves = movesFor(draft, 'dragged' as NodeId, documentRect(0, 0, 3, 2))

    expect(moves.map((m) => m.id).sort()).toEqual(['a', 'dragged'])
    expect(moves.find((m) => m.id === 'dragged')?.rect).toMatchObject({ x: 0, y: 0 })
    expect(moves.find((m) => m.id === 'a')?.rect).toMatchObject({ y: 2 })
  })

  it('returns only what CHANGED', () => {
    // So the history entry is the size of the change rather than the size of the dashboard, and
    // a widget nothing displaced contributes nothing to the undo.
    const draft = hydrate(snapshot([widget('far', 6, 0), widget('dragged', 0, 4)]))
    const moves = movesFor(draft, 'dragged' as NodeId, documentRect(0, 0, 3, 2))

    expect(moves.map((m) => m.id)).toEqual(['dragged'])
  })

  it('returns nothing when a widget is dropped where it already is', () => {
    // An empty batch is a no-op in the engine, so this produces no history entry at all — a
    // click that moved nothing must not consume an undo.
    const draft = hydrate(snapshot([widget('a', 0, 0)]))
    expect(movesFor(draft, 'a' as NodeId, documentRect(0, 0, 3, 2))).toEqual([])
  })
})

describe('removal closes the gap', () => {
  it('lifts what was below the removed widget', () => {
    const draft = hydrate(snapshot([widget('a', 0, 0), widget('b', 0, 2), widget('c', 0, 4)]))
    const moves = compactionFor(draft, 'b' as NodeId)

    expect(moves.map((m) => m.id)).toEqual(['c'])
    expect(moves[0]?.rect.y).toBe(2)
  })

  it('does not report the removed widget', () => {
    // It is being deleted by its own action; including it would make the batch try to move a
    // node that no longer exists.
    const draft = hydrate(snapshot([widget('a', 0, 0), widget('b', 0, 4)]))
    expect(compactionFor(draft, 'a' as NodeId).map((m) => m.id)).not.toContain('a')
  })

  it('reports nothing when the grid was already tight', () => {
    const draft = hydrate(snapshot([widget('a', 0, 0), widget('b', 0, 2)]))
    expect(compactionFor(draft, 'b' as NodeId)).toEqual([])
  })
})
