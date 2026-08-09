import type { DashboardSnapshot } from '@fitnessos/ctx-dashboard'
import type { Widget, WidgetContent } from '@fitnessos/ctx-dashboard'
import { DashboardSchema, type components } from '@fitnessos/contracts'
import type { z } from 'zod'
import { parseContract, type FieldsAgree } from './parse'

/** Dashboard mappers. Widget order carries nothing here, so it is passed through untouched. */
type ContractDashboard = components['schemas']['Dashboard']
type ValidatedDashboard = z.infer<typeof DashboardSchema>

const contentFrom = (raw: ValidatedDashboard['widgets'][number]['content']): WidgetContent => {
  if (raw.kind === 'upcoming-sessions') return { kind: 'upcoming-sessions' }
  if (raw.kind === 'unjudged-proposals') return { kind: 'unjudged-proposals' }
  return {
    kind: 'indicator',
    indicatorKind: raw.indicatorKind ?? '',
    fallbackLabel: raw.fallbackLabel ?? '',
  }
}

export const dashboardFrom = (raw: unknown): DashboardSnapshot => {
  const c = parseContract(DashboardSchema, raw, 'Dashboard')
  return {
    id: c.id,
    title: c.title,
    columns: c.columns,
    widgets: c.widgets.map(
      (w): Widget => ({
        id: w.id,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        content: contentFrom(w.content),
      }),
    ),
  }
}

export const dashboardBodyFrom = (d: DashboardSnapshot): ValidatedDashboard => {
  const body = {
    id: d.id,
    title: d.title,
    columns: d.columns,
    widgets: d.widgets.map((w) => ({
      id: w.id,
      x: w.x,
      y: w.y,
      width: w.width,
      height: w.height,
      // `absent, not null`: the indicator fields are constrained, so sending them as null for a
      // sessions widget would be refused for fields nobody filled in.
      content:
        w.content.kind === 'indicator'
          ? {
              kind: 'indicator',
              indicatorKind: w.content.indicatorKind,
              fallbackLabel: w.content.fallbackLabel,
            }
          : { kind: w.content.kind },
    })),
  }
  return parseContract(DashboardSchema, body, 'Dashboard (request)')
}

export const DASHBOARD_COVERAGE: Record<keyof ContractDashboard, true> = {
  id: true,
  title: true,
  columns: true,
  widgets: true,
}

const _agrees: FieldsAgree<ContractDashboard, ValidatedDashboard> = true
void _agrees
