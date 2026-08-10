import type { NodeId } from '../document/snapshot'
import {
  rectContains,
  rectsOverlap,
  type DocumentPoint,
  type DocumentRect,
} from './spaces'
import type { SpatialHash } from './spatialHash'

/**
 * Hit testing — what is under the pointer, and what a marquee caught.
 *
 * ## Why order matters more than it looks
 *
 * A click on overlapping tiles must select the one the user believes they clicked, which is the
 * one drawn on top. The document has no z-axis: `rootIds` order IS the paint order, last drawn
 * last. So a hit test that returned the spatial index's order — which is bucket iteration order,
 * an implementation detail — would select an arbitrary tile whenever two overlap, and the user
 * would learn that clicking is unreliable rather than that the app has a rule.
 *
 * Both functions therefore take the document's own id order and return results in it. `hitPoint`
 * returns topmost-first; `hitRect` returns document order, because a marquee selection is a set
 * and the set's order should be stable and readable rather than reversed.
 */

/**
 * Everything under a point, topmost first.
 *
 * Returns all of them rather than just the top, because the caller decides: a plain click takes
 * the first, an alt-click cycles, and a context menu may want the stack. Deciding here would
 * make the second of those impossible without a second function.
 */
export const hitPoint = (
  hash: SpatialHash,
  order: readonly NodeId[],
  point: DocumentPoint,
): readonly NodeId[] => {
  // A zero-area rect at the point: the index answers rect queries, and a point is a degenerate
  // rect. This keeps one query path rather than two that could disagree at a boundary.
  const candidates = new Set(hash.query({ x: point.x, y: point.y, width: 0, height: 0 } as DocumentRect))

  const hits: NodeId[] = []
  for (const id of order) {
    if (!candidates.has(id)) continue
    const rect = hash.rectOf(id)
    if (rect !== null && rectContains(rect, point)) hits.push(id)
  }
  // Reversed at the end rather than iterating backwards, so the two functions read as one rule
  // applied twice — document order, then a stated reversal — instead of two loops to compare.
  return hits.reverse()
}

/**
 * Everything a marquee touched, in document order.
 *
 * OVERLAP, not containment. A marquee that only caught fully-enclosed tiles forces the user to
 * drag past content they can see they are selecting, which is the behaviour of a tool that has
 * not decided what a marquee means. Figma, Illustrator and every editor a user brings habits
 * from use overlap.
 */
export const hitRect = (
  hash: SpatialHash,
  order: readonly NodeId[],
  region: DocumentRect,
): readonly NodeId[] => {
  const candidates = new Set(hash.query(region))
  const hits: NodeId[] = []
  for (const id of order) {
    if (!candidates.has(id)) continue
    const rect = hash.rectOf(id)
    if (rect !== null && rectsOverlap(region, rect)) hits.push(id)
  }
  return hits
}
