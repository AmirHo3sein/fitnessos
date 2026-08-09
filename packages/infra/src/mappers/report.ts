import type { ReportSnapshot, Tile, TileContent } from '@fitnessos/ctx-report'
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

export const reportFrom = (raw: unknown): ReportSnapshot => {
  const c = parseContract(ReportSchema, raw, 'Report')
  return {
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
  }
}

export const reportBodyFrom = (report: ReportSnapshot): ValidatedReport => {
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
  }
  return parseContract(ReportSchema, body, 'Report (request)')
}

export const REPORT_COVERAGE: Record<keyof ContractReport, true> = {
  id: true,
  title: true,
  tiles: true,
}

const _reportAgrees: FieldsAgree<ContractReport, ValidatedReport> = true
void _reportAgrees
