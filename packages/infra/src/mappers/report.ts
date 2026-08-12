import type { Loaded, ReportSnapshot, Tile, TileContent } from '@fitnessos/ctx-report'
import { ReportSchema, type components } from '@fitnessos/contracts'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/**
 * Report mappers.
 *
 * The one rule worth stating: **tile order is preserved verbatim.** It is paint order — which
 * tile draws on top — so the tidying instinct that sorts a list on the way through would
 * silently rearrange what a coach composed.
 */

type ContractReport = components['schemas']['Report']
type ValidatedReport = z.infer<typeof ReportSchema>

const contentFrom = (raw: ValidatedReport['tiles'][number]['content']): TileContent =>
  raw.kind === 'note'
    ? { kind: 'note', text: raw.text ?? '' }
    : {
        kind: 'indicator',
        indicatorKind: raw.indicatorKind ?? '',
        fallbackLabel: raw.fallbackLabel ?? '',
      }

const snapshotFrom = (c: ValidatedReport): ReportSnapshot => ({
  id: c.id,
  title: c.title,
  tiles: c.tiles.map(
    (tile): Tile => ({
      id: tile.id,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      content: contentFrom(tile.content),
    }),
  ),
})

export const reportFrom = (raw: unknown): ReportSnapshot =>
  snapshotFrom(parseContract(ReportSchema, raw, 'Report'))

/**
 * The report, and the revision to send back when saving it (§2.1a).
 *
 * `revision` is read here and left OUT of the snapshot on purpose: the snapshot is the editor's
 * document, and a revision inside an undoable document is restored by undo — the next save then
 * answers 409 for a reason the author cannot see (ADR-0035).
 *
 * Absent means a server older than §2.1a. That becomes `null` — no base — rather than a default,
 * because any invented number would satisfy the precondition and overwrite what is stored.
 */
export const reportLoadedFrom = (raw: unknown): Loaded<ReportSnapshot> => {
  const c = parseContract(ReportSchema, raw, 'Report')
  return { artefact: snapshotFrom(c), revision: c.revision ?? null }
}

export const reportBodyFrom = (
  report: ReportSnapshot,
  baseRevision: number | null = null,
): ValidatedReport => {
  const body = {
    id: report.id,
    title: report.title,
    tiles: report.tiles.map((tile) => ({
      id: tile.id,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      // `absent, not null` again: the contract constrains the indicator fields, so sending them
      // as null for a note would be refused for fields the coach never filled in.
      content:
        tile.content.kind === 'note'
          ? { kind: 'note', text: tile.content.text }
          : {
              kind: 'indicator',
              indicatorKind: tile.content.indicatorKind,
              fallbackLabel: tile.content.fallbackLabel,
            },
    })),
    // Omitted entirely on a first save: absent means "nothing is stored yet", and a null on the
    // wire would be a claim about a revision rather than the absence of one.
    ...(baseRevision === null ? {} : { baseRevision }),
  }
  return parseContract(ReportSchema, body, 'Report (request)')
}

export const REPORT_COVERAGE: Record<keyof ContractReport, true> = {
  id: true,
  title: true,
  tiles: true,
  // Accounted for beside the document rather than in it: read into `Loaded`, sent back as
  // `baseRevision`. Covered, and deliberately absent from `ReportSnapshot`.
  revision: true,
  baseRevision: true,
}

const _reportAgrees: FieldsAgree<ContractReport, ValidatedReport> = true
void _reportAgrees
