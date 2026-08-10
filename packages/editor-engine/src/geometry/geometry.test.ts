import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { NodeId } from '../document/snapshot'
import { SpatialHash } from './spatialHash'
import {
  documentPoint,
  documentRect,
  fromClient,
  clientPoint,
  screenPixels,
  thresholdInDocument,
  toDocument,
  toScreen,
  type Viewport,
} from './spaces'

const id = (n: string) => n as NodeId
const view = (panX = 0, panY = 0, zoom = 1): Viewport => ({
  pan: documentPoint(panX, panY),
  zoom,
})

describe('coordinate conversion', () => {
  it('is identity at the origin with zoom 1', () => {
    const screen = toScreen(view(), documentPoint(10, 20))
    expect([screen.x, screen.y]).toEqual([10, 20])
  })

  it('applies pan then zoom, in that order', () => {
    // Zoom-then-pan and pan-then-zoom give different answers, and getting it backwards produces an
    // editor where the cursor drifts from the thing it is dragging as you zoom.
    const screen = toScreen(view(100, 50, 2), documentPoint(150, 100))
    expect([screen.x, screen.y]).toEqual([100, 100])
  })

  it('round-trips document → screen → document at any pan and zoom', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: 0.1, max: 8, noNaN: true }),
        (x, y, panX, panY, zoom) => {
          const viewport = view(panX, panY, zoom)
          const back = toDocument(viewport, toScreen(viewport, documentPoint(x, y)))
          expect(back.x).toBeCloseTo(x, 6)
          expect(back.y).toBeCloseTo(y, 6)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('converts a client point relative to the container', () => {
    const screen = fromClient({ left: 40, top: 15 }, clientPoint(100, 80))
    expect([screen.x, screen.y]).toEqual([60, 65])
  })

  it('shrinks a screen threshold in document units as zoom increases', () => {
    // 8 screen pixels is a smaller document distance the further you zoom in — which is what makes
    // snapping feel constant to the user, because what they judge is the gap they can SEE.
    expect(thresholdInDocument(view(0, 0, 1), screenPixels(8))).toBe(8)
    expect(thresholdInDocument(view(0, 0, 2), screenPixels(8))).toBe(4)
    expect(thresholdInDocument(view(0, 0, 0.5), screenPixels(8))).toBe(16)
  })
})

describe('SpatialHash', () => {
  const hash = () => new SpatialHash(64)

  it('finds a rect that overlaps the query', () => {
    const h = hash()
    h.insert(id('a'), documentRect(10, 10, 20, 20))
    expect(h.query(documentRect(15, 15, 5, 5))).toEqual([id('a')])
  })

  it('does NOT return a bucket neighbour that misses the query', () => {
    // The classic spatial-hash bug: bucket membership is necessary, not sufficient. A hit test that
    // selects the thing NEXT to what you clicked is worse than a slow one.
    const h = hash()
    h.insert(id('a'), documentRect(0, 0, 10, 10))
    expect(h.query(documentRect(40, 40, 5, 5))).toEqual([])
  })

  it('finds a rect spanning several cells', () => {
    const h = hash()
    h.insert(id('wide'), documentRect(0, 0, 500, 10))
    expect(h.query(documentRect(400, 5, 2, 2))).toEqual([id('wide')])
  })

  it('handles negative coordinates', () => {
    // `Math.floor` on a negative quotient is the easy thing to get wrong here, and an editor that
    // pans left is not an edge case.
    const h = hash()
    h.insert(id('a'), documentRect(-100, -100, 20, 20))
    expect(h.query(documentRect(-95, -95, 5, 5))).toEqual([id('a')])
  })

  it('finds rects exactly on a cell boundary', () => {
    const h = hash()
    h.insert(id('a'), documentRect(64, 64, 10, 10))
    expect(h.query(documentRect(64, 64, 1, 1))).toEqual([id('a')])
  })

  it('move leaves no stale bucket entry', () => {
    // The whole point of patching rather than rebuilding — and the way a patch goes wrong is by
    // leaving the id in a bucket it has left, so it keeps being hit-tested where it no longer is.
    const h = hash()
    h.insert(id('a'), documentRect(10, 10, 10, 10))
    h.move(id('a'), documentRect(500, 500, 10, 10))

    expect(h.query(documentRect(10, 10, 5, 5))).toEqual([])
    expect(h.query(documentRect(500, 500, 5, 5))).toEqual([id('a')])
  })

  it('move on an unknown id inserts it', () => {
    const h = hash()
    h.move(id('a'), documentRect(0, 0, 10, 10))
    expect(h.query(documentRect(0, 0, 5, 5))).toEqual([id('a')])
  })

  it('remove clears every bucket the rect spanned', () => {
    const h = hash()
    h.insert(id('wide'), documentRect(0, 0, 500, 10))
    h.remove(id('wide'))
    expect(h.query(documentRect(400, 5, 2, 2))).toEqual([])
    expect(h.size).toBe(0)
  })

  it('re-inserting the same id replaces rather than duplicates', () => {
    const h = hash()
    h.insert(id('a'), documentRect(0, 0, 10, 10))
    h.insert(id('a'), documentRect(200, 200, 10, 10))
    expect(h.size).toBe(1)
    expect(h.query(documentRect(0, 0, 5, 5))).toEqual([])
  })

  it('snapCandidates widens the search by the screen threshold', () => {
    const h = hash()
    // Gap of 8 document units between the moving rect's right edge (20) and this one's left (28).
    // Deliberately NOT exactly the threshold: proximity is a STRICT comparison, so a gap equal to
    // the threshold is excluded, and a test sitting on that boundary would be asserting float
    // equality rather than behaviour.
    h.insert(id('near'), documentRect(28, 0, 10, 10))

    const moving = documentRect(0, 0, 20, 10)
    // 10 screen px at zoom 1 = 10 document units > the 8-unit gap → found.
    expect(h.snapCandidates(moving, screenPixels(10), view())).toHaveLength(1)
    // The same 10 screen px at zoom 4 is only 2.5 document units → not found. This is the whole
    // reason the threshold is in screen units: the snap feels constant to the user at any zoom.
    expect(h.snapCandidates(moving, screenPixels(10), view(0, 0, 4))).toHaveLength(0)
  })

  it('snapCandidates excludes the moving rect itself', () => {
    const h = hash()
    const moving = documentRect(0, 0, 20, 10)
    h.insert(id('self'), moving)
    expect(h.snapCandidates(moving, screenPixels(20), view())).toEqual([])
  })

  it('every inserted rect is found by a query covering it', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -500, max: 500 }),
            y: fc.integer({ min: -500, max: 500 }),
            w: fc.integer({ min: 1, max: 200 }),
            h: fc.integer({ min: 1, max: 200 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (specs) => {
          const h = hash()
          for (const [i, s] of specs.entries()) {
            h.insert(id(`n${String(i)}`), documentRect(s.x, s.y, s.w, s.h))
          }
          for (const [i, s] of specs.entries()) {
            const found = h.query(documentRect(s.x, s.y, s.w, s.h))
            expect(found).toContain(id(`n${String(i)}`))
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
