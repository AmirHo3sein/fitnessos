import type { DashboardSnapshot, Loaded } from '@fitnessos/ctx-dashboard'
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

/**
 * The document alone — `revision` is dropped here on purpose.
 *
 * `DashboardSnapshot` is the editor's undoable document, and a precondition on a write is not part
 * of it: as undoable state, undo would restore a stale revision and the next save would answer 409
 * for a reason the author cannot see (ADR-0035). It leaves through `dashboardLoadedFrom` instead.
 */
const snapshotFrom = (c: ValidatedDashboard): DashboardSnapshot => {
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

/**
 * The document and the revision to send back when saving it (BACKEND-CONTRACT §2.1a).
 *
 * One parse, split two ways: the snapshot goes to the editor, the revision stays at the port
 * boundary. Absent — a server older than §2.1a — is `null` rather than a guessed 1, because a
 * fabricated base satisfies the precondition against work the client never read, which is the
 * overwrite §2.1a exists to prevent. Let the server decide.
 */
export const dashboardLoadedFrom = (raw: unknown): Loaded<DashboardSnapshot> => {
  const c = parseContract(DashboardSchema, raw, 'Dashboard')
  return { artefact: snapshotFrom(c), revision: c.revision ?? null }
}

/** `baseRevision` goes through the schema like everything else: it is a wire field, not a header. */
export const dashboardBodyFrom = (
  d: DashboardSnapshot,
  baseRevision: number | null,
): ValidatedDashboard => {
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
    // `absent, not null` again, and here it changes the outcome rather than the wording: null
    // against an artefact that exists reads as "I believe nothing is here" and is refused with 409.
    // Absent says the same about a FIRST save, which is the only time it is true.
    ...(baseRevision === null ? {} : { baseRevision }),
  }
  return parseContract(DashboardSchema, body, 'Dashboard (request)')
}

export const DASHBOARD_COVERAGE: Record<keyof ContractDashboard, true> = {
  id: true,
  title: true,
  columns: true,
  widgets: true,
  // Both handled at the port boundary rather than in the snapshot: read as the envelope's
  // `revision`, sent back as `baseRevision`. Neither reaches the editor document (ADR-0035).
  revision: true,
  baseRevision: true,
}

const _agrees: FieldsAgree<ContractDashboard, ValidatedDashboard> = true
void _agrees
