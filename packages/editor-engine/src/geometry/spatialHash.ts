import type { NodeId } from '../document/snapshot'
import {
  rectsOverlap,
  thresholdInDocument,
  type DocumentRect,
  type ScreenPixels,
  type Viewport,
} from './spaces'

/**
 * Grid-bucketed spatial index (handbook D-03). **Not a quadtree.**
 *
 * Roughly forty lines against a quadtree's two hundred, O(1) insert and query, and the assumption
 * it depends on holds here: editor nodes fall within about one order of magnitude in size. A
 * quadtree earns its complexity when sizes vary wildly, which is a document this codebase does not
 * produce.
 *
 * It degrades if node sizes vary more than ~10×, which is why `cellSize` is per-editor
 * configuration rather than a constant — Report Builder 128, Program Builder 64.
 *
 * `move` patches two buckets rather than rebuilding. That is the difference between a drag that
 * runs at 60fps and one that does not: a rebuild is O(n) per frame, and a drag produces a frame
 * every 16ms.
 */
export class SpatialHash {
  private readonly rects = new Map<NodeId, DocumentRect>()
  private readonly buckets = new Map<string, Set<NodeId>>()

  constructor(private readonly cellSize: number) {}

  private keysFor(rect: DocumentRect): readonly string[] {
    const keys: string[] = []
    const minX = Math.floor(rect.x / this.cellSize)
    const maxX = Math.floor((rect.x + rect.width) / this.cellSize)
    const minY = Math.floor(rect.y / this.cellSize)
    const maxY = Math.floor((rect.y + rect.height) / this.cellSize)
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) keys.push(`${String(x)}:${String(y)}`)
    }
    return keys
  }

  insert(id: NodeId, rect: DocumentRect): void {
    this.remove(id)
    this.rects.set(id, rect)
    for (const key of this.keysFor(rect)) {
      const bucket = this.buckets.get(key) ?? new Set<NodeId>()
      bucket.add(id)
      this.buckets.set(key, bucket)
    }
  }

  /** Patches only the buckets that changed. See the note on the class. */
  move(id: NodeId, rect: DocumentRect): void {
    const previous = this.rects.get(id)
    if (previous === undefined) {
      this.insert(id, rect)
      return
    }

    const before = new Set(this.keysFor(previous))
    const after = new Set(this.keysFor(rect))

    for (const key of before) {
      if (!after.has(key)) this.buckets.get(key)?.delete(id)
    }
    for (const key of after) {
      if (!before.has(key)) {
        const bucket = this.buckets.get(key) ?? new Set<NodeId>()
        bucket.add(id)
        this.buckets.set(key, bucket)
      }
    }
    this.rects.set(id, rect)
  }

  remove(id: NodeId): void {
    const rect = this.rects.get(id)
    if (rect === undefined) return
    for (const key of this.keysFor(rect)) this.buckets.get(key)?.delete(id)
    this.rects.delete(id)
  }

  rectOf(id: NodeId): DocumentRect | null {
    return this.rects.get(id) ?? null
  }

  get size(): number {
    return this.rects.size
  }

  /**
   * Everything overlapping a region.
   *
   * Bucket membership is necessary but not sufficient — a node sharing a bucket can still miss the
   * query rect — so candidates are filtered by an exact overlap test. Skipping that is the classic
   * spatial-hash bug: it returns near-misses, and a hit test that selects the thing NEXT to what
   * you clicked is worse than a slow one.
   */
  query(region: DocumentRect): readonly NodeId[] {
    const candidates = new Set<NodeId>()
    for (const key of this.keysFor(region)) {
      for (const id of this.buckets.get(key) ?? []) candidates.add(id)
    }

    const hits: NodeId[] = []
    for (const id of candidates) {
      const rect = this.rects.get(id)
      if (rect !== undefined && rectsOverlap(region, rect)) hits.push(id)
    }
    return hits
  }

  /**
   * Rects near enough to snap to, for a moving rect.
   *
   * The threshold arrives in SCREEN pixels and is converted here, at query time (D-04). A
   * document-unit threshold would make snapping tighter as you zoom in — the opposite of what a
   * user expects, because what they are judging is the gap they can see.
   *
   * Proximity is STRICT: a rect exactly `threshold` away is not a candidate. That follows from
   * `rectsOverlap` treating touching edges as non-overlapping, which is right for hit-testing —
   * clicking the boundary between two nodes should not select both — and the same rule is applied
   * here rather than having two different notions of "adjacent" in one engine.
   */
  snapCandidates(
    moving: DocumentRect,
    threshold: ScreenPixels,
    viewport: Viewport,
  ): readonly DocumentRect[] {
    const margin = thresholdInDocument(viewport, threshold)
    const region = {
      x: moving.x - margin,
      y: moving.y - margin,
      width: moving.width + margin * 2,
      height: moving.height + margin * 2,
    } as DocumentRect

    return this.query(region)
      .map((id) => this.rects.get(id))
      .filter((rect): rect is DocumentRect => rect !== undefined && rect !== moving)
  }
}
