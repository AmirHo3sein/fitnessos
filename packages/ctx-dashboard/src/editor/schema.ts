import {
  clampToGrid,
  compactGrid,
  documentRect,
  emptyDocument,
  resolveCollisions,
  type DocumentRect,
  type DocumentSnapshot,
  type Node,
  type NodeId,
} from '@fitnessos/editor-engine'
import type { Widget, WidgetContent } from '../domain/Dashboard'

/**
 * The Dashboard Builder's document schema (handbook D-09).
 *
 * The fourth editor on this engine, and the third topology: row index for a programme, pixels
 * for a report, CELLS here. The engine needed one additive module (`geometry/grid`) and nothing
 * else — the document is the same flat record of nodes, and what the numbers in `props` MEAN is
 * the builder's business, which is the property that has now held four times.
 *
 * ## Where the grid differs from the canvas
 *
 * A report commits a drag straight to `x` and `y`. A dashboard cannot: dropping a widget on an
 * occupied cell has to displace whatever was there, so a move is
 *
 *     propose → resolveCollisions → commit EVERY rect that changed
 *
 * which is several nodes in one gesture, and therefore a `dispatchBatch` rather than a pair of
 * `SetProperty` calls. One drag is still one undo — but it is one undo that restores three
 * widgets, and it only works because the batch primitive exists. That primitive was added for
 * align on the report canvas; this is the second thing that needed it, which is the usual sign
 * it was the right shape.
 */

export const DASHBOARD_SCHEMA_ID = 'dashboard'
export const DASHBOARD_SCHEMA_VERSION = 1

export const WIDGET_NODE = 'widget'

export interface PreservedDashboardFields {
  readonly id: string
  readonly title: string
  readonly columns: number
}

export interface DashboardSnapshot {
  readonly id: string
  readonly title: string
  readonly columns: number
  readonly widgets: readonly Widget[]
}

export interface DashboardDraft {
  readonly document: DocumentSnapshot
  readonly preserved: PreservedDashboardFields
}

export const HYDRATE_COVERAGE: Record<keyof DashboardSnapshot, 'document' | 'preserved'> = {
  widgets: 'document',
  id: 'preserved',
  title: 'preserved',
  // Preserved rather than editable: changing the column count reflows every widget, which is a
  // command with its own confirmation rather than a property to nudge in a builder.
  columns: 'preserved',
}

const str = (props: Readonly<Record<string, unknown>>, key: string): string =>
  typeof props[key] === 'string' ? props[key] : ''

const num = (props: Readonly<Record<string, unknown>>, key: string, fallback: number): number =>
  typeof props[key] === 'number' && Number.isFinite(props[key]) ? props[key] : fallback

const contentFrom = (props: Readonly<Record<string, unknown>>): WidgetContent => {
  const kind = str(props, 'contentKind')
  if (kind === 'upcoming-sessions') return { kind: 'upcoming-sessions' }
  if (kind === 'unjudged-proposals') return { kind: 'unjudged-proposals' }
  return {
    kind: 'indicator',
    indicatorKind: str(props, 'indicatorKind'),
    fallbackLabel: str(props, 'fallbackLabel'),
  }
}

const propsFrom = (content: WidgetContent): Record<string, unknown> =>
  content.kind === 'indicator'
    ? {
        contentKind: 'indicator',
        indicatorKind: content.indicatorKind,
        fallbackLabel: content.fallbackLabel,
      }
    : { contentKind: content.kind, indicatorKind: '', fallbackLabel: '' }

export const hydrate = (snapshot: DashboardSnapshot): DashboardDraft => {
  const document = emptyDocument(DASHBOARD_SCHEMA_ID, DASHBOARD_SCHEMA_VERSION)

  const nodes: Record<string, Node> = {}
  const childIds: Record<string, readonly NodeId[]> = {}
  const rootIds: NodeId[] = []

  for (const widget of snapshot.widgets) {
    const nodeId = widget.id as NodeId
    nodes[nodeId] = {
      id: nodeId,
      type: WIDGET_NODE,
      props: {
        x: widget.x,
        y: widget.y,
        width: widget.width,
        height: widget.height,
        ...propsFrom(widget.content),
      },
    }
    childIds[nodeId] = []
    rootIds.push(nodeId)
  }

  return {
    document: { ...document, nodes, childIds, rootIds },
    preserved: { id: snapshot.id, title: snapshot.title, columns: snapshot.columns },
  }
}

export const commit = (draft: DashboardDraft): DashboardSnapshot => ({
  ...draft.preserved,
  widgets: draft.document.rootIds.map((nodeId) => {
    const props = draft.document.nodes[nodeId]?.props ?? {}
    // Clamped on the way out, so a document that somehow holds an off-grid rect commits as a
    // valid one rather than as something the aggregate refuses. The builder cannot produce that;
    // a hand-edited or migrated document can.
    const rect = clampToGrid(rectOfNode(props), draft.preserved.columns)
    return {
      id: nodeId,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      content: contentFrom(props),
    }
  }),
})

/** A widget's rect, derived from props. Never stored twice — see the note in the report schema. */
export const rectOfNode = (props: Readonly<Record<string, unknown>>): DocumentRect =>
  documentRect(num(props, 'x', 0), num(props, 'y', 0), num(props, 'width', 3), num(props, 'height', 2))

/**
 * The rects a move produces, once the grid has rearranged around it.
 *
 * Returns only what CHANGED, so the resulting history entry is the size of the change rather
 * than the size of the dashboard — and a widget nothing displaced contributes nothing to the
 * undo.
 */
export const movesFor = (
  draft: DashboardDraft,
  movedId: NodeId,
  to: DocumentRect,
): readonly { readonly id: NodeId; readonly rect: DocumentRect }[] => {
  /*
   * Two separate lists, and the distinction is the whole correctness of this function.
   *
   * `current` is where things are NOW; `proposed` is that with the dragged widget at its new
   * rect. Resolution runs on the proposal, and the diff is against `current`.
   *
   * The first version used one list with the move already applied and diffed against it, so the
   * moved widget compared equal to itself and never appeared in the result — a drag that
   * displaced nothing produced no action at all, and the widget snapped back.
   */
  const current = draft.document.rootIds.map((id) => ({
    id,
    rect: rectOfNode(draft.document.nodes[id]?.props ?? {}),
  }))

  const proposed = current.map((item) => (item.id === movedId ? { ...item, rect: to } : item))
  const after = resolveCollisions(proposed, movedId, draft.preserved.columns)

  return after.filter((item) => {
    const was = current.find((c) => c.id === item.id)?.rect
    return (
      was !== undefined &&
      (was.x !== item.rect.x ||
        was.y !== item.rect.y ||
        was.width !== item.rect.width ||
        was.height !== item.rect.height)
    )
  })
}

/**
 * The rects a removal leaves behind, after closing the gap.
 *
 * Compaction happens on REMOVAL and not on every move, because pulling widgets upward under the
 * user's hand while they are still deciding where to drop one is disorienting.
 */
export const compactionFor = (
  draft: DashboardDraft,
  removedId: NodeId,
): readonly { readonly id: NodeId; readonly rect: DocumentRect }[] => {
  const remaining = draft.document.rootIds
    .filter((id) => id !== removedId)
    .map((id) => ({ id, rect: rectOfNode(draft.document.nodes[id]?.props ?? {}) }))

  return compactGrid(remaining, draft.preserved.columns).filter((item) => {
    const was = remaining.find((r) => r.id === item.id)?.rect
    return was !== undefined && (was.x !== item.rect.x || was.y !== item.rect.y)
  })
}

/** Nothing derived, so a round trip must be exact. */
export const normalize = (snapshot: DashboardSnapshot): DashboardSnapshot => snapshot
