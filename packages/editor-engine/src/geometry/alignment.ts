import { documentRect, type DocumentRect } from './spaces'

/**
 * Align and distribute — the commands, not the drag.
 *
 * ## Why these return positions rather than mutating
 *
 * They produce a list of `{ id, rect }`, which the caller turns into ONE history entry. Aligning
 * six tiles is one thing the user did, and one undo should reverse it. A function that moved
 * things itself would either bypass history or produce six entries, and a user pressing undo
 * once would watch five tiles stay where they were put.
 */

export interface Positioned<Id> {
  readonly id: Id
  readonly rect: DocumentRect
}

export type Alignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'

const bounds = (items: readonly Positioned<unknown>[]) => {
  const left = Math.min(...items.map((i) => i.rect.x))
  const right = Math.max(...items.map((i) => i.rect.x + i.rect.width))
  const top = Math.min(...items.map((i) => i.rect.y))
  const bottom = Math.max(...items.map((i) => i.rect.y + i.rect.height))
  return { left, right, top, bottom }
}

/**
 * Align a selection to its own bounding box.
 *
 * To the SELECTION's bounds, not the canvas'. Aligning to the canvas would move a tidy group to
 * the far edge of the document the first time someone pressed "align left", which is not what
 * anyone means by aligning things to each other.
 *
 * Fewer than two items returns them unchanged: a single tile is already aligned with itself, and
 * moving it would make the button feel like it did something arbitrary.
 */
export const align = <Id>(
  items: readonly Positioned<Id>[],
  how: Alignment,
): readonly Positioned<Id>[] => {
  if (items.length < 2) return items
  const { left, right, top, bottom } = bounds(items)

  return items.map((item) => {
    const { rect } = item
    switch (how) {
      case 'left':
        return { ...item, rect: documentRect(left, rect.y, rect.width, rect.height) }
      case 'right':
        return { ...item, rect: documentRect(right - rect.width, rect.y, rect.width, rect.height) }
      case 'center-x':
        return {
          ...item,
          rect: documentRect(
            (left + right) / 2 - rect.width / 2,
            rect.y,
            rect.width,
            rect.height,
          ),
        }
      case 'top':
        return { ...item, rect: documentRect(rect.x, top, rect.width, rect.height) }
      case 'bottom':
        return { ...item, rect: documentRect(rect.x, bottom - rect.height, rect.width, rect.height) }
      case 'center-y':
        return {
          ...item,
          rect: documentRect(
            rect.x,
            (top + bottom) / 2 - rect.height / 2,
            rect.width,
            rect.height,
          ),
        }
    }
  })
}

/**
 * Distribute so the GAPS between items are equal.
 *
 * Equal gaps, not equal centres — and the difference is the whole feature. Spacing centres
 * evenly leaves visibly uneven whitespace whenever the items differ in size, which is exactly
 * when someone reaches for this button. Equal gaps is what "distribute" means to the eye.
 *
 * The outermost two items do not move: they define the span. Moving them would make the command
 * change the group's extent, and pressing it twice would keep shrinking or growing the layout.
 *
 * Fewer than three items returns them unchanged — there is no gap to equalise between two.
 */
export const distribute = <Id>(
  items: readonly Positioned<Id>[],
  axis: 'x' | 'y',
): readonly Positioned<Id>[] => {
  if (items.length < 3) return items

  const sorted = [...items].sort((a, b) =>
    axis === 'x' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y,
  )
  const size = (rect: DocumentRect) => (axis === 'x' ? rect.width : rect.height)
  const start = (rect: DocumentRect) => (axis === 'x' ? rect.x : rect.y)

  // Narrowed rather than asserted. The length check above makes both present, so an assertion
  // would be correct — and a suppressed check is a suppressed check, and this costs two lines.
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === undefined || last === undefined) return items

  const span = start(last.rect) + size(last.rect) - start(first.rect)
  const occupied = sorted.reduce((total, item) => total + size(item.rect), 0)
  const gap = (span - occupied) / (sorted.length - 1)

  let cursor = start(first.rect)
  return sorted.map((item, index) => {
    if (index === 0 || index === sorted.length - 1) {
      cursor = start(item.rect) + size(item.rect) + gap
      return item
    }
    const placed =
      axis === 'x'
        ? documentRect(cursor, item.rect.y, item.rect.width, item.rect.height)
        : documentRect(item.rect.x, cursor, item.rect.width, item.rect.height)
    cursor += size(item.rect) + gap
    return { ...item, rect: placed }
  })
}
