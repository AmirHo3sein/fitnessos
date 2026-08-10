/**
 * Three coordinate spaces, branded so mixing them is a compile error (handbook D-04).
 *
 * The three are genuinely different and constantly confused:
 *
 *   DOCUMENT  the editor's own units. Per-editor: pixels in the Report Builder, grid cells in the
 *             Dashboard Builder, milliseconds in the Timeline Builder, row index in the Program
 *             Builder. This is what the document stores.
 *   SCREEN    pixels after pan and zoom, relative to the editor's container.
 *   CLIENT    pixels as a DOM event reports them, relative to the viewport.
 *
 * A number alone cannot say which it is, and every editor bug of the form "it works until you
 * zoom" is one of these used where another was meant. Branding turns that from a debugging session
 * into a type error.
 *
 * The cost is conversion noise at the boundaries. That is the trade, and it is worth it: this
 * eliminates the highest-frequency bug class in an editor.
 */

declare const documentSpace: unique symbol
declare const screenSpace: unique symbol
declare const clientSpace: unique symbol

export interface DocumentPoint {
  readonly x: number
  readonly y: number
  readonly [documentSpace]: true
}
export interface ScreenPoint {
  readonly x: number
  readonly y: number
  readonly [screenSpace]: true
}
export interface ClientPoint {
  readonly x: number
  readonly y: number
  readonly [clientSpace]: true
}

export interface DocumentRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly [documentSpace]: true
}
export interface ScreenRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly [screenSpace]: true
}

/**
 * A distance in SCREEN pixels.
 *
 * Snap thresholds are always this, never document units, and converted at query time. A threshold
 * in document units would mean snapping feels tighter as you zoom in and looser as you zoom out —
 * the opposite of what a user expects, since what they are judging is the gap they can SEE.
 */
export type ScreenPixels = number & { readonly [screenSpace]: true }

export const documentPoint = (x: number, y: number): DocumentPoint => ({ x, y }) as DocumentPoint
export const screenPoint = (x: number, y: number): ScreenPoint => ({ x, y }) as ScreenPoint
export const clientPoint = (x: number, y: number): ClientPoint => ({ x, y }) as ClientPoint
export const documentRect = (x: number, y: number, width: number, height: number): DocumentRect =>
  ({ x, y, width, height }) as DocumentRect
export const screenPixels = (n: number): ScreenPixels => n as ScreenPixels

export interface Viewport {
  readonly pan: DocumentPoint
  readonly zoom: number
}

export const toScreen = (viewport: Viewport, point: DocumentPoint): ScreenPoint =>
  screenPoint((point.x - viewport.pan.x) * viewport.zoom, (point.y - viewport.pan.y) * viewport.zoom)

export const toDocument = (viewport: Viewport, point: ScreenPoint): DocumentPoint =>
  documentPoint(point.x / viewport.zoom + viewport.pan.x, point.y / viewport.zoom + viewport.pan.y)

export const rectToScreen = (viewport: Viewport, rect: DocumentRect): ScreenRect => {
  const origin = toScreen(viewport, documentPoint(rect.x, rect.y))
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  } as ScreenRect
}

/**
 * A DOM event's coordinates, relative to the editor container.
 *
 * `containerRect` comes from `getBoundingClientRect`, which must be read in the single measurement
 * pass (D-03) rather than here — calling it during a pointer move interleaves a layout read with
 * style writes and forces synchronous reflow on every frame.
 */
export const fromClient = (
  containerRect: { readonly left: number; readonly top: number },
  point: ClientPoint,
): ScreenPoint => screenPoint(point.x - containerRect.left, point.y - containerRect.top)

/** A screen-space threshold expressed in document units, for the current zoom. */
export const thresholdInDocument = (viewport: Viewport, threshold: ScreenPixels): number =>
  threshold / viewport.zoom

export const rectContains = (rect: DocumentRect, point: DocumentPoint): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height

export const rectsOverlap = (a: DocumentRect, b: DocumentRect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
