import {
  documentRect,
  thresholdInDocument,
  type DocumentRect,
  type ScreenPixels,
  type Viewport,
} from './spaces'

/**
 * Snapping — grid, edge and centre alignment while dragging.
 *
 * ## Why every threshold is in ScreenPixels
 *
 * This is the whole point of D-04's branded spaces, and it is the bug the branding exists to
 * make unrepresentable.
 *
 * Snapping is a statement about the user's hand: "when the thing you are dragging comes within
 * about eight pixels of an edge, help it land". Eight pixels means eight pixels ON SCREEN. If
 * the threshold were held in document units, then at 25% zoom it would take 32 screen pixels of
 * hand movement to trigger — snapping would feel sticky when zoomed out and slippery when zoomed
 * in, and the person would describe it as "sometimes it snaps, sometimes it doesn't".
 *
 * So the threshold is `ScreenPixels`, converted to document units at query time against the
 * current viewport. `thresholdInDocument` is the only conversion, and it is called once per
 * query rather than baked into a config.
 *
 * ## What snapping returns
 *
 * A DELTA, not a position. The caller is mid-drag and already knows where the pointer is; giving
 * it a corrected rect would mean the drag logic and the snapper both own the position, and they
 * would disagree the first time a drag was constrained to one axis.
 */

export interface SnapConfig {
  /** Distance within which a snap applies, ON SCREEN. See the header. */
  readonly threshold: ScreenPixels
  /** Document units. Zero disables grid snapping without a second flag to forget. */
  readonly gridSize: number
}

export interface SnapResult {
  /** How far to move the dragged rect, in document units. Zero on each axis when nothing snapped. */
  readonly dx: number
  readonly dy: number
  /** The lines that produced the snap, for rendering guides. Empty when nothing snapped. */
  readonly guides: readonly GuideLine[]
}

/**
 * A line to draw while dragging, in DOCUMENT units.
 *
 * Document rather than screen, because the caller renders inside the transformed canvas. Handing
 * it screen coordinates would force it to invert the transform it is already inside — and that
 * inversion is exactly the arithmetic D-04 exists to stop being written by hand at every call
 * site.
 */
export interface GuideLine {
  readonly axis: 'x' | 'y'
  /** Where the line sits on its axis. */
  readonly at: number
  readonly kind: 'grid' | 'edge' | 'center'
}

const edgesX = (rect: DocumentRect): readonly number[] => [
  rect.x,
  rect.x + rect.width / 2,
  rect.x + rect.width,
]

const edgesY = (rect: DocumentRect): readonly number[] => [
  rect.y,
  rect.y + rect.height / 2,
  rect.y + rect.height,
]

/** Which of a rect's three candidate lines an offset came from. Centre is the middle one. */
const kindAt = (index: number): GuideLine['kind'] => (index === 1 ? 'center' : 'edge')

interface Candidate {
  readonly delta: number
  readonly at: number
  readonly kind: GuideLine['kind']
}

/**
 * The nearest candidate within tolerance, or null.
 *
 * Strictly nearest, and ties resolved by taking the FIRST — which, given the order the callers
 * build candidates in, means an alignment to another tile beats an alignment to the grid at the
 * same distance. That is the right default: a user dragging next to an existing tile is almost
 * always trying to line up with the tile, and the grid is a fallback for empty canvas.
 */
const nearest = (candidates: readonly Candidate[], tolerance: number): Candidate | null => {
  let best: Candidate | null = null
  for (const candidate of candidates) {
    if (Math.abs(candidate.delta) > tolerance) continue
    if (best === null || Math.abs(candidate.delta) < Math.abs(best.delta)) best = candidate
  }
  return best
}

/**
 * Snap a dragged rect against other rects and the grid.
 *
 * `others` is what the caller decided is worth considering — normally the spatial index's
 * neighbours rather than every tile in the document, which is what makes this O(neighbours)
 * instead of O(document) on every pointer move.
 */
export const snap = (
  moving: DocumentRect,
  others: readonly DocumentRect[],
  viewport: Viewport,
  config: SnapConfig,
): SnapResult => {
  // Converted here, once, against the CURRENT viewport — so the same config snaps identically at
  // every zoom level.
  const tolerance = thresholdInDocument(viewport, config.threshold)

  const xs: Candidate[] = []
  const ys: Candidate[] = []

  // Alignment to other rects first, so it wins a tie against the grid. See `nearest`.
  for (const other of others) {
    for (const [i, from] of edgesX(moving).entries()) {
      for (const to of edgesX(other)) xs.push({ delta: to - from, at: to, kind: kindAt(i) })
    }
    for (const [i, from] of edgesY(moving).entries()) {
      for (const to of edgesY(other)) ys.push({ delta: to - from, at: to, kind: kindAt(i) })
    }
  }

  if (config.gridSize > 0) {
    // The moving rect's LEADING edge only. Snapping its centre and trailing edge to the grid as
    // well would give three competing answers for one axis, and a tile whose width is not a
    // multiple of the grid would jitter between them as the pointer moved.
    const gx = Math.round(moving.x / config.gridSize) * config.gridSize
    const gy = Math.round(moving.y / config.gridSize) * config.gridSize
    xs.push({ delta: gx - moving.x, at: gx, kind: 'grid' })
    ys.push({ delta: gy - moving.y, at: gy, kind: 'grid' })
  }

  const x = nearest(xs, tolerance)
  const y = nearest(ys, tolerance)

  const guides: GuideLine[] = []
  // A guide is drawn per AXIS that snapped, not per candidate. Drawing every line within
  // tolerance would paint a thicket the moment a tile approached a cluster.
  if (x !== null) guides.push({ axis: 'x', at: x.at, kind: x.kind })
  if (y !== null) guides.push({ axis: 'y', at: y.at, kind: y.kind })

  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides }
}

/** Apply a snap. Separate from `snap` so a caller can preview guides without committing a move. */
export const applySnap = (rect: DocumentRect, result: SnapResult): DocumentRect =>
  documentRect(rect.x + result.dx, rect.y + result.dy, rect.width, rect.height)
