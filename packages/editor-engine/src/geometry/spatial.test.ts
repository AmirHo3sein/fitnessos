import { describe, expect, it } from 'vitest'
import type { NodeId } from '../document/snapshot'
import { align, distribute, type Positioned } from './alignment'
import { hitPoint, hitRect } from './hitTest'
import { applySnap, snap } from './snapping'
import { documentPoint, documentRect, screenPixels, type Viewport } from './spaces'
import { SpatialHash } from './spatialHash'

const id = (n: string) => n as NodeId
const at = (x: number, y: number, w = 100, h = 50) => documentRect(x, y, w, h)

const indexed = (entries: readonly [string, ReturnType<typeof at>][]) => {
  const hash = new SpatialHash(128)
  for (const [name, rect] of entries) hash.insert(id(name), rect)
  return { hash, order: entries.map(([name]) => id(name)) }
}

const viewport = (zoom: number): Viewport => ({ pan: documentPoint(0, 0), zoom })

describe('hit testing', () => {
  it('returns overlapping tiles TOPMOST first', () => {
    /**
     * The document has no z-axis: `rootIds` order is paint order, last drawn last. A hit test
     * returning the spatial index's order would return bucket iteration order — an
     * implementation detail — so a click on overlapping tiles would select an arbitrary one and
     * the user would learn that clicking is unreliable rather than that the app has a rule.
     */
    const { hash, order } = indexed([
      ['under', at(0, 0)],
      ['over', at(10, 10)],
    ])
    expect(hitPoint(hash, order, documentPoint(20, 20))).toEqual([id('over'), id('under')])
  })

  it('returns nothing for a point in empty space', () => {
    const { hash, order } = indexed([['a', at(0, 0)]])
    expect(hitPoint(hash, order, documentPoint(500, 500))).toEqual([])
  })

  it('a marquee catches what it OVERLAPS, not only what it encloses', () => {
    // A marquee that required full containment forces the user to drag past content they can see
    // they are selecting — the behaviour of a tool that has not decided what a marquee means.
    const { hash, order } = indexed([
      ['partly', at(0, 0)],
      ['fully', at(200, 0, 20, 20)],
      ['outside', at(1000, 1000)],
    ])
    expect(hitRect(hash, order, documentRect(50, 10, 400, 30))).toEqual([
      id('partly'),
      id('fully'),
    ])
  })

  it('returns a marquee selection in document order, not reversed', () => {
    // A selection is a set; its order should be stable and readable. Only a point hit is
    // topmost-first, because only a click has to answer "which one did I mean".
    const { hash, order } = indexed([
      ['a', at(0, 0)],
      ['b', at(0, 60)],
      ['c', at(0, 120)],
    ])
    expect(hitRect(hash, order, documentRect(0, 0, 200, 200))).toEqual([id('a'), id('b'), id('c')])
  })
})

describe('snapping thresholds live in SCREEN pixels', () => {
  const config = { threshold: screenPixels(8), gridSize: 0 }
  const other = at(200, 0)

  it('snaps a rect whose edge is within tolerance', () => {
    const moving = at(195, 0)
    const result = snap(moving, [other], viewport(1), config)
    expect(result.dx).toBe(5)
    expect(applySnap(moving, result).x).toBe(200)
  })

  it('does NOT snap beyond tolerance', () => {
    expect(snap(at(150, 0), [other], viewport(1), config).dx).toBe(0)
  })

  it('reaches FURTHER in document units when zoomed out', () => {
    /**
     * The bug the branded spaces exist to prevent. Eight pixels means eight pixels on screen —
     * the user's hand. A threshold held in document units would take 32 screen pixels of
     * movement to trigger at 25% zoom, and the person would report "sometimes it snaps and
     * sometimes it doesn't" rather than anything a developer could act on.
     */
    const moving = at(180, 0)
    expect(snap(moving, [other], viewport(1), config).dx).toBe(0)
    expect(snap(moving, [other], viewport(0.25), config).dx).toBe(20)
  })

  it('reaches LESS far in document units when zoomed in', () => {
    const moving = at(197, 0)
    expect(snap(moving, [other], viewport(1), config).dx).toBe(3)
    expect(snap(moving, [other], viewport(4), config).dx).toBe(0)
  })
})

describe('what snapping chooses', () => {
  it('prefers the nearest candidate', () => {
    const near = at(200, 0)
    const far = at(206, 0)
    expect(snap(at(202, 0), [near, far], viewport(1), { threshold: screenPixels(8), gridSize: 0 }).dx)
      .toBe(-2)
  })

  it('aligns centres, not only edges', () => {
    // Centre alignment is what makes a column of differently-sized tiles look deliberate.
    const other = at(0, 0, 100, 50)
    const moving = at(20, 200, 60, 50)
    const result = snap(moving, [other], viewport(1), { threshold: screenPixels(8), gridSize: 0 })

    // Moving centre 50 → other centre 50: already aligned, so the edge candidates decide.
    expect(result.guides.some((g) => g.kind === 'center' || g.kind === 'edge')).toBe(true)
  })

  it('lets an alignment beat the grid at equal distance', () => {
    // A user dragging next to an existing tile is almost always trying to line up with the tile.
    // The grid is a fallback for empty canvas.
    const result = snap(at(98, 0), [at(96, 0)], viewport(1), {
      threshold: screenPixels(8),
      gridSize: 100,
    })
    expect(result.dx).toBe(-2)
    expect(result.guides[0]?.kind).toBe('edge')
  })

  it('snaps to the grid when nothing else is near', () => {
    const result = snap(at(103, 0), [], viewport(1), { threshold: screenPixels(8), gridSize: 100 })
    expect(result.dx).toBe(-3)
    expect(result.guides[0]?.kind).toBe('grid')
  })

  it('draws at most one guide per axis', () => {
    // Drawing every line within tolerance paints a thicket the moment a tile nears a cluster.
    const result = snap(at(199, 1), [at(200, 0), at(200, 2), at(201, 0)], viewport(1), {
      threshold: screenPixels(8),
      gridSize: 100,
    })
    expect(result.guides.filter((g) => g.axis === 'x')).toHaveLength(1)
    expect(result.guides.filter((g) => g.axis === 'y')).toHaveLength(1)
  })

  it('reports no guides when nothing snapped', () => {
    const result = snap(at(500, 500), [at(0, 0)], viewport(1), {
      threshold: screenPixels(8),
      gridSize: 0,
    })
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] })
  })
})

describe('align', () => {
  const items: Positioned<string>[] = [
    { id: 'a', rect: at(0, 0, 100, 50) },
    { id: 'b', rect: at(40, 100, 60, 50) },
    { id: 'c', rect: at(20, 200, 80, 50) },
  ]

  it('aligns to the SELECTION’s bounds, not the canvas', () => {
    // Aligning to the canvas would fling a tidy group to the far edge of the document the first
    // time someone pressed "align left".
    expect(align(items, 'left').map((i) => i.rect.x)).toEqual([0, 0, 0])
  })

  it('aligns right edges, accounting for differing widths', () => {
    expect(align(items, 'right').map((i) => i.rect.x + i.rect.width)).toEqual([100, 100, 100])
  })

  it('centres horizontally', () => {
    const centres = align(items, 'center-x').map((i) => i.rect.x + i.rect.width / 2)
    expect(new Set(centres).size).toBe(1)
  })

  it('leaves the other axis alone', () => {
    expect(align(items, 'left').map((i) => i.rect.y)).toEqual([0, 100, 200])
  })

  it('does nothing to a single item', () => {
    // It is already aligned with itself, and moving it would make the button feel arbitrary.
    const one = [items[0]!]
    expect(align(one, 'left')).toEqual(one)
  })
})

describe('distribute', () => {
  it('equalises GAPS, not centres', () => {
    /**
     * The whole feature. Spacing centres evenly leaves visibly uneven whitespace whenever items
     * differ in size — which is exactly when someone reaches for this button.
     */
    const items: Positioned<string>[] = [
      { id: 'a', rect: at(0, 0, 100, 50) },
      { id: 'b', rect: at(120, 0, 20, 50) },
      { id: 'c', rect: at(300, 0, 100, 50) },
    ]

    const out = distribute(items, 'x')
    const gaps = out
      .slice(1)
      .map((item, i) => item.rect.x - (out[i]!.rect.x + out[i]!.rect.width))

    expect(gaps[0]).toBeCloseTo(gaps[1]!, 6)
  })

  it('does not move the outermost items', () => {
    // They define the span. Moving them would make the command change the group's extent, so
    // pressing it twice would keep shrinking or growing the layout.
    const items: Positioned<string>[] = [
      { id: 'a', rect: at(0, 0) },
      { id: 'b', rect: at(120, 0) },
      { id: 'c', rect: at(400, 0) },
    ]
    const out = distribute(items, 'x')
    expect(out[0]!.rect.x).toBe(0)
    expect(out[2]!.rect.x).toBe(400)
  })

  it('sorts by position rather than trusting the selection order', () => {
    // A selection is built in click order, which has nothing to do with layout.
    const items: Positioned<string>[] = [
      { id: 'c', rect: at(400, 0) },
      { id: 'a', rect: at(0, 0) },
      { id: 'b', rect: at(120, 0) },
    ]
    expect(distribute(items, 'x').map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('does nothing with fewer than three', () => {
    // There is no gap to equalise between two.
    const two: Positioned<string>[] = [
      { id: 'a', rect: at(0, 0) },
      { id: 'b', rect: at(200, 0) },
    ]
    expect(distribute(two, 'x')).toEqual(two)
  })
})
