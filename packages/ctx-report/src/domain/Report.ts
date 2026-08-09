import { err, ok, type Result } from '@fitnessos/kernel'

/**
 * `Report` — a coach-authored arrangement of published views.
 *
 * ## What a report owns, which is almost nothing
 *
 * A report owns a LAYOUT. It does not own an indicator, a goal or a programme; it points at them
 * (D-08), and everything it displays is resolved through a `ReferenceResolver` at render time.
 * That is why this context can exist without violating ADR-0004's six centres — it is not a
 * seventh centre of the domain, it is an artefact assembled from published language.
 *
 * The practical consequence is the one worth stating: **a report cannot go stale in a way that
 * matters.** If the indicator it charts is deleted, the tile renders broken and the rest of the
 * report is fine, because nothing here holds a copy of anything.
 *
 * ## Document units are pixels (D-04)
 *
 * Per the handbook: px for Report, grid cells for Dashboard, milliseconds for Timeline, row
 * index for Program and Form. A tile's `x`, `y`, `width` and `height` are document pixels, and
 * every threshold that touches the user's hand — snapping tolerance, hit slop — is
 * `ScreenPixels` converted at query time.
 */

const brand = Symbol('Report')

/**
 * What a tile shows. CLOSED, because the variants differ in required structure: a chart needs
 * something to chart, a note needs text (ADR-0020's exception).
 */
export type TileContent =
  | {
      readonly kind: 'indicator'
      /** The indicator series to chart. Resolved through the D-08 port, never dereferenced here. */
      readonly indicatorKind: string
      /**
       * The only renderable content when resolution fails — D-08's `fallbackLabel` requirement.
       * Written once when the tile is created and never refreshed from the resolver, because a
       * fallback that tracked the live label would be empty in exactly the case it exists for.
       */
      readonly fallbackLabel: string
    }
  | { readonly kind: 'note'; readonly text: string }

export interface Tile {
  readonly id: string
  /** Document pixels. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly content: TileContent
}

export interface Report {
  readonly [brand]: true
  readonly id: string
  readonly title: string
  readonly tiles: readonly Tile[]
}

export type ReportError =
  | { readonly kind: 'title-empty' }
  | { readonly kind: 'duplicate-tile-id'; readonly id: string }
  | { readonly kind: 'tile-not-positive-size'; readonly id: string }
  | { readonly kind: 'tile-position-not-finite'; readonly id: string }
  | { readonly kind: 'indicator-tile-charts-nothing'; readonly id: string }
  | { readonly kind: 'fallback-label-empty'; readonly id: string }

/**
 * The smallest tile that can hold a legible chart.
 *
 * Not a style preference: below this an axis label collides with the value and the tile shows
 * something misleading rather than something small. A drag that could shrink a tile past it
 * would let a coach build a report that lies at a glance.
 */
export const MIN_TILE_SIZE = 40

export interface ReportInput {
  readonly id: string
  readonly title: string
  readonly tiles: readonly Tile[]
}

export const report = (input: ReportInput): Result<Report, ReportError> => {
  if (input.title.trim() === '') return err({ kind: 'title-empty' })

  const seen = new Set<string>()
  for (const tile of input.tiles) {
    if (seen.has(tile.id)) return err({ kind: 'duplicate-tile-id', id: tile.id })
    seen.add(tile.id)

    if (!Number.isFinite(tile.x) || !Number.isFinite(tile.y)) {
      // NaN is what a drag produces when a coordinate conversion goes wrong, and it propagates
      // silently: the tile vanishes from the canvas and every hit test misses it.
      return err({ kind: 'tile-position-not-finite', id: tile.id })
    }
    if (tile.width < MIN_TILE_SIZE || tile.height < MIN_TILE_SIZE) {
      return err({ kind: 'tile-not-positive-size', id: tile.id })
    }

    if (tile.content.kind === 'indicator') {
      if (tile.content.indicatorKind.trim() === '') {
        return err({ kind: 'indicator-tile-charts-nothing', id: tile.id })
      }
      if (tile.content.fallbackLabel.trim() === '') {
        // D-08: without it a broken reference renders as "(unavailable)" and the reader has no
        // idea which chart is missing.
        return err({ kind: 'fallback-label-empty', id: tile.id })
      }
    }
  }

  /*
   * NOT sorted, and no order field at all — unlike a programme or a form.
   *
   * A report is spatial: position is the arrangement, and the list order carries a different
   * fact, which is paint order for overlapping tiles. Sorting here would silently reorder what
   * is drawn on top, and adding an `order` field would give paint order two homes.
   */
  return ok({ [brand]: true, id: input.id, title: input.title.trim(), tiles: input.tiles })
}
