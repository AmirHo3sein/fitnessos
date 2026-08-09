import { documentRect, type DocumentRect } from './spaces'

/**
 * Grid topology — the Dashboard's document units.
 *
 * Per D-04, document units are per editor: pixels for Report, row index for Program and Form,
 * milliseconds for Timeline, and **grid cells** here. A widget at `{ x: 2, y: 0, width: 4,
 * height: 2 }` occupies four columns and two rows, and nothing in this file knows how wide a
 * column is on screen. That conversion is the viewport's job, and keeping it there is what lets
 * the same document render at any container width.
 *
 * ## What a grid needs that free positioning does not
 *
 * The Report Builder's tiles may overlap; overlapping is a layout choice there. On a grid it is
 * not — two widgets in one cell is a state with no rendering. So a grid needs **collision
 * resolution**, and that is the whole of what this file adds.
 *
 * Resolution pushes DOWN, never sideways and never up. Sideways would move a widget into a
 * column the user did not choose, and upward creates cycles — A pushes B up into C, which pushes
 * A. Downward always terminates because the grid is unbounded below, and it matches what every
 * dashboard a user has met already does.
 *
 * ## Why `react-grid-layout` is not used
 *
 * The handbook asks for it to be evaluated, so: no, and the reason is D-11's rule rather than a
 * preference. That ADR lets a library own rendering and interaction — for React Flow — and is
 * explicit that its internal state is never the source of truth, with the drag exception granted
 * because per-frame translation through the document would be too slow.
 *
 * A grid drag has no such cost. The Report Builder already drags at sixty frames a second
 * through the ephemeral channel without touching the document, and a grid is strictly less work:
 * positions are integers, and snapping is not a search because a cell IS the snap.
 *
 * So adopting it would buy collision handling — the forty lines below — in exchange for a second
 * source of truth during every interaction, a second set of coordinate conventions, and a
 * dependency on a route whose weight is already measured. The trade is worse in every direction.
 */

export interface GridItem<Id> {
  readonly id: Id
  /** In CELLS. `x` and `width` are columns, `y` and `height` are rows. */
  readonly rect: DocumentRect
}

const overlaps = (a: DocumentRect, b: DocumentRect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * Keep a rect inside the grid's columns, and out of negative rows.
 *
 * Clamped rather than rejected: a drag that ran off the edge should stop at the edge, not refuse
 * to move. A widget wider than the grid is narrowed rather than pushed off it, because the
 * alternative is a widget the user can see and cannot reach.
 */
export const clampToGrid = (rect: DocumentRect, columns: number): DocumentRect => {
  // Every component rounded, including the sizes. A fractional width has no rendering in a grid
  // for exactly the same reason a fractional position does not, and rounding three of the four
  // was an inconsistency a test caught rather than a subtlety.
  const width = Math.max(1, Math.min(Math.round(rect.width), columns))
  const height = Math.max(1, Math.round(rect.height))
  const x = Math.max(0, Math.min(Math.round(rect.x), columns - width))
  return documentRect(x, Math.max(0, Math.round(rect.y)), width, height)
}

/**
 * Resolve overlaps by pushing displaced items down.
 *
 * `moved` is the item the user just placed and it does NOT move — everything else yields to it.
 * That is the rule a person expects: the thing under your finger goes where you put it, and the
 * grid rearranges around it. Resolving by moving the dragged item instead makes the drop feel
 * like it was refused.
 *
 * Items are settled in reading order — top to bottom, then left to right — so the result depends
 * on the layout rather than on the order the caller happened to store things in. Without that,
 * the same drag would produce different arrangements on two devices.
 */
export const resolveCollisions = <Id>(
  items: readonly GridItem<Id>[],
  moved: Id,
  columns: number,
): readonly GridItem<Id>[] => {
  const anchor = items.find((item) => item.id === moved)
  if (anchor === undefined) return items

  const settled: GridItem<Id>[] = [{ ...anchor, rect: clampToGrid(anchor.rect, columns) }]

  const rest = items
    .filter((item) => item.id !== moved)
    .slice()
    .sort((a, b) => (a.rect.y === b.rect.y ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))

  for (const item of rest) {
    let rect = clampToGrid(item.rect, columns)
    // Push down until it clears everything already placed. Bounded by the number of settled
    // items times their heights, so it terminates — but written as a loop over a recomputed
    // collision rather than a fixed count, because a fixed count would silently give up.
    let collision = settled.find((other) => overlaps(other.rect, rect))
    while (collision !== undefined) {
      rect = documentRect(rect.x, collision.rect.y + collision.rect.height, rect.width, rect.height)
      collision = settled.find((other) => overlaps(other.rect, rect))
    }
    settled.push({ ...item, rect })
  }

  // Returned in the CALLER's order, not settle order. The caller's order is paint order and its
  // own business; only the rects were the question.
  return items.map((item) => settled.find((s) => s.id === item.id) ?? item)
}

/**
 * Close vertical gaps, so the grid does not accumulate holes.
 *
 * Called after a removal rather than after every move: compacting during a drag would yank
 * widgets upward under the user's hand while they are still deciding where to put one.
 */
export const compactGrid = <Id>(
  items: readonly GridItem<Id>[],
  columns: number,
): readonly GridItem<Id>[] => {
  const settled: GridItem<Id>[] = []

  const inReadingOrder = [...items].sort((a, b) =>
    a.rect.y === b.rect.y ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
  )

  for (const item of inReadingOrder) {
    let rect = clampToGrid(item.rect, columns)
    // Rise until something is in the way, then stop one row below it.
    while (rect.y > 0) {
      const above = documentRect(rect.x, rect.y - 1, rect.width, rect.height)
      if (settled.some((other) => overlaps(other.rect, above))) break
      rect = above
    }
    settled.push({ ...item, rect })
  }

  return items.map((item) => settled.find((s) => s.id === item.id) ?? item)
}
