import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { clampToGrid, compactGrid, resolveCollisions, type GridItem } from './grid'
import { documentRect, type DocumentRect } from './spaces'

const COLUMNS = 12
const at = (x: number, y: number, w = 3, h = 2) => documentRect(x, y, w, h)
const item = (id: string, rect: DocumentRect): GridItem<string> => ({ id, rect })

const overlapping = (items: readonly GridItem<string>[]): boolean => {
  for (const a of items) {
    for (const b of items) {
      if (a.id === b.id) continue
      const hit =
        a.rect.x < b.rect.x + b.rect.width &&
        b.rect.x < a.rect.x + a.rect.width &&
        a.rect.y < b.rect.y + b.rect.height &&
        b.rect.y < a.rect.y + a.rect.height
      if (hit) return true
    }
  }
  return false
}

describe('clamping', () => {
  it('stops a widget at the edge rather than refusing to move it', () => {
    // A drag that ran off the side should stop at the side. Refusing feels like the grid
    // rejected the gesture.
    expect(clampToGrid(at(20, 0), COLUMNS).x).toBe(COLUMNS - 3)
    expect(clampToGrid(at(-5, -5), COLUMNS)).toMatchObject({ x: 0, y: 0 })
  })

  it('narrows a widget wider than the grid rather than pushing it off', () => {
    // The alternative is a widget the user can see and cannot reach.
    expect(clampToGrid(at(0, 0, 40, 2), COLUMNS)).toMatchObject({ x: 0, width: COLUMNS })
  })

  it('rounds to whole cells, because half a cell has no rendering', () => {
    expect(clampToGrid(documentRect(2.6, 1.4, 3.5, 2.2), COLUMNS)).toMatchObject({
      x: 3,
      y: 1,
      width: 4,
      height: 2,
    })
  })
})

describe('collision resolution', () => {
  it('leaves the moved widget exactly where it was dropped', () => {
    /**
     * The rule a person expects: the thing under your finger goes where you put it, and the grid
     * rearranges around it. Resolving by moving the DRAGGED item instead makes the drop feel
     * like it was refused, which is the single most common way a grid feels broken.
     */
    const settled = resolveCollisions(
      [item('a', at(0, 0)), item('dragged', at(0, 0))],
      'dragged',
      COLUMNS,
    )
    expect(settled.find((i) => i.id === 'dragged')?.rect).toMatchObject({ x: 0, y: 0 })
  })

  it('pushes the displaced widget down, not sideways', () => {
    // Sideways would move it into a column the user never chose.
    const settled = resolveCollisions(
      [item('a', at(0, 0)), item('dragged', at(0, 0))],
      'dragged',
      COLUMNS,
    )
    const pushed = settled.find((i) => i.id === 'a')?.rect
    expect(pushed).toMatchObject({ x: 0, y: 2 })
  })

  it('cascades through a column without leaving an overlap', () => {
    const settled = resolveCollisions(
      [item('a', at(0, 0)), item('b', at(0, 2)), item('c', at(0, 4)), item('dragged', at(0, 0))],
      'dragged',
      COLUMNS,
    )
    expect(overlapping(settled)).toBe(false)
  })

  it('does not disturb a widget in another column', () => {
    // Only what is actually in the way should move; a grid that reshuffles everything on every
    // drop is one nobody can arrange deliberately.
    const settled = resolveCollisions(
      [item('far', at(6, 0)), item('dragged', at(0, 0))],
      'dragged',
      COLUMNS,
    )
    expect(settled.find((i) => i.id === 'far')?.rect).toMatchObject({ x: 6, y: 0 })
  })

  it('settles in reading order, so the result does not depend on storage order', () => {
    /**
     * Without this the same drag produces different arrangements depending on the order the
     * caller happened to hold things in — which differs between a fresh load and a session that
     * has added a widget, so two devices would disagree about the same dashboard.
     */
    const forwards = [item('a', at(0, 0)), item('b', at(0, 2)), item('dragged', at(0, 0))]
    const backwards = [item('b', at(0, 2)), item('a', at(0, 0)), item('dragged', at(0, 0))]

    const rectsOf = (settled: readonly GridItem<string>[]) =>
      [...settled].sort((x, y) => x.id.localeCompare(y.id)).map((i) => i.rect)

    expect(rectsOf(resolveCollisions(forwards, 'dragged', COLUMNS))).toEqual(
      rectsOf(resolveCollisions(backwards, 'dragged', COLUMNS)),
    )
  })

  it('returns items in the caller’s order, not settle order', () => {
    // The caller's order is paint order and its own business. Only the rects were the question.
    const items = [item('z', at(0, 4)), item('a', at(0, 0)), item('dragged', at(0, 0))]
    expect(resolveCollisions(items, 'dragged', COLUMNS).map((i) => i.id)).toEqual([
      'z',
      'a',
      'dragged',
    ])
  })

  it('never leaves an overlap, for any arrangement', () => {
    // The property the whole file exists for: two widgets in one cell is a state with no
    // rendering, so it must be unreachable however they were placed.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 11 }),
            y: fc.integer({ min: 0, max: 8 }),
            w: fc.integer({ min: 1, max: 6 }),
            h: fc.integer({ min: 1, max: 3 }),
          }),
          { minLength: 2, maxLength: 7 },
        ),
        (specs) => {
          const items = specs.map((s, i) => item(`i${String(i)}`, at(s.x, s.y, s.w, s.h)))
          expect(overlapping(resolveCollisions(items, 'i0', COLUMNS))).toBe(false)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('compaction', () => {
  it('closes the gap a removal left', () => {
    const settled = compactGrid([item('a', at(0, 0)), item('b', at(0, 6))], COLUMNS)
    expect(settled.find((i) => i.id === 'b')?.rect.y).toBe(2)
  })

  it('does not lift a widget through another', () => {
    const settled = compactGrid(
      [item('a', at(0, 0)), item('b', at(0, 4)), item('c', at(0, 8))],
      COLUMNS,
    )
    expect(settled.map((i) => i.rect.y)).toEqual([0, 2, 4])
    expect(overlapping(settled)).toBe(false)
  })

  it('leaves an already-tight grid alone', () => {
    // Idempotent, so calling it twice cannot creep. A compaction that shifted a settled layout
    // would move widgets the user placed for no reason they could see.
    const tight = [item('a', at(0, 0)), item('b', at(3, 0)), item('c', at(0, 2))]
    expect(compactGrid(compactGrid(tight, COLUMNS), COLUMNS)).toEqual(compactGrid(tight, COLUMNS))
  })
})
