import { err, ok, type Result } from '@fitnessos/kernel'

/**
 * `Dashboard` — the screen an athlete opens, arranged on a grid.
 *
 * ## How this differs from a Report, which is a fair question
 *
 * Both are arrangements of published views, and both own only a layout. They differ in the one
 * thing that decides a topology: a report is positioned in PIXELS and read like a document —
 * printed, reviewed, sent to someone. A dashboard is positioned in CELLS and lived in — it must
 * reflow at a phone's width without a coach re-authoring it, which free positioning cannot do.
 *
 * That is why the columns are part of the document and the coordinates are integers. It is also
 * why widgets may not overlap, where tiles may: overlapping is a layout choice on a canvas and a
 * rendering error on a grid.
 *
 * ## What it owns
 *
 * A layout, and nothing else. Every widget names what it shows and is resolved at render time
 * through the D-08 port, so a deleted indicator breaks one widget rather than the screen.
 */

const brand = Symbol('Dashboard')

/**
 * What a widget shows. CLOSED, because the variants differ in required structure: an indicator
 * widget needs something to chart, the others need nothing (ADR-0020's exception).
 */
export type WidgetContent =
  | {
      readonly kind: 'indicator'
      readonly indicatorKind: string
      /** D-08's fallback: the only renderable content when the reference cannot be resolved. */
      readonly fallbackLabel: string
    }
  | { readonly kind: 'upcoming-sessions' }
  | { readonly kind: 'unjudged-proposals' }

export interface Widget {
  readonly id: string
  /** Grid CELLS. `x`/`width` are columns, `y`/`height` are rows. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly content: WidgetContent
}

export interface Dashboard {
  readonly [brand]: true
  readonly id: string
  readonly title: string
  /**
   * How many columns the layout is authored against.
   *
   * On the DOCUMENT rather than in the renderer, because a widget four columns wide means
   * nothing without knowing four of how many. A renderer that assumed twelve would silently
   * halve every layout the day someone authored against six.
   */
  readonly columns: number
  readonly widgets: readonly Widget[]
}

export type DashboardError =
  | { readonly kind: 'title-empty' }
  | { readonly kind: 'columns-out-of-range'; readonly given: number }
  | { readonly kind: 'duplicate-widget-id'; readonly id: string }
  | { readonly kind: 'widget-not-positive-size'; readonly id: string }
  | { readonly kind: 'widget-off-grid'; readonly id: string }
  | { readonly kind: 'widget-position-not-whole'; readonly id: string }
  | { readonly kind: 'widgets-overlap'; readonly a: string; readonly b: string }
  | { readonly kind: 'indicator-widget-charts-nothing'; readonly id: string }

/**
 * Between four and twenty-four columns.
 *
 * Below four, a widget cannot be narrower than a quarter of the screen and the grid stops being
 * a grid. Above twenty-four, a cell is thinner than a finger and the layout can only be authored
 * with a mouse — which for a product used on a phone means authored by someone who is not the
 * person using it.
 */
export const MIN_COLUMNS = 4
export const MAX_COLUMNS = 24

const overlaps = (a: Widget, b: Widget): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

export interface DashboardInput {
  readonly id: string
  readonly title: string
  readonly columns: number
  readonly widgets: readonly Widget[]
}

export const dashboard = (input: DashboardInput): Result<Dashboard, DashboardError> => {
  if (input.title.trim() === '') return err({ kind: 'title-empty' })
  if (
    !Number.isInteger(input.columns) ||
    input.columns < MIN_COLUMNS ||
    input.columns > MAX_COLUMNS
  ) {
    return err({ kind: 'columns-out-of-range', given: input.columns })
  }

  const seen = new Set<string>()
  for (const widget of input.widgets) {
    if (seen.has(widget.id)) return err({ kind: 'duplicate-widget-id', id: widget.id })
    seen.add(widget.id)

    if (![widget.x, widget.y, widget.width, widget.height].every(Number.isInteger)) {
      // Half a cell has no rendering. A fraction here is a conversion that went wrong, and it
      // propagates as a widget that sits between rows forever.
      return err({ kind: 'widget-position-not-whole', id: widget.id })
    }
    if (widget.width < 1 || widget.height < 1) {
      return err({ kind: 'widget-not-positive-size', id: widget.id })
    }
    if (widget.x < 0 || widget.y < 0 || widget.x + widget.width > input.columns) {
      // A widget past the last column is one the athlete can see and cannot reach.
      return err({ kind: 'widget-off-grid', id: widget.id })
    }
    if (widget.content.kind === 'indicator' && widget.content.indicatorKind.trim() === '') {
      return err({ kind: 'indicator-widget-charts-nothing', id: widget.id })
    }
  }

  for (const [i, a] of input.widgets.entries()) {
    for (const b of input.widgets.slice(i + 1)) {
      if (overlaps(a, b)) return err({ kind: 'widgets-overlap', a: a.id, b: b.id })
    }
  }

  /*
   * Widgets are NOT sorted, and there is no order field.
   *
   * Unlike a report, where list order is paint order, a grid has no overlap — so list order
   * carries nothing at all, and the layout is entirely in the coordinates. Sorting would be
   * harmless and is omitted for the same reason a field would be: it would imply a meaning that
   * is not there.
   */
  return ok({
    [brand]: true,
    id: input.id,
    title: input.title.trim(),
    columns: input.columns,
    widgets: input.widgets,
  })
}
