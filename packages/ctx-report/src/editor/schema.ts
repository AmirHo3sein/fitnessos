import {
  emptyDocument,
  type DocumentRect,
  type DocumentSnapshot,
  type Node,
  type NodeId,
} from '@fitnessos/editor-engine'
import { documentRect } from '@fitnessos/editor-engine'
import type { Tile, TileContent } from '../domain/Report'

/**
 * The Report Builder's document schema (handbook D-09).
 *
 * ## What differs from the two tree editors, and what does not
 *
 * A programme and a form are ORDERED: `rootIds` position is the order, and moving a block is a
 * `MoveNodes`. A report is SPATIAL: position lives in props as `x` and `y`, and `rootIds` order
 * carries a different fact entirely — which tile paints on top when two overlap.
 *
 * The engine absorbed that without change. `rootIds` was never named "the order"; it is the
 * document's own sequence, and what a builder means by it is the builder's business.
 *
 * ## Why dragging is SetProperty and not a new action
 *
 * A spatial move changes two numbers on one node. `MoveNodes` is tree topology — it re-parents
 * and re-indexes — and using it here would have meant either bending it or adding an action to
 * the registry, which would have broken Phase 4's exit gate.
 *
 * Two `SetProperty` dispatches instead, and they COALESCE into one history entry for free:
 * `shouldCoalesce` requires the same action type and the same targets, which `x` and `y` on one
 * tile satisfy. One drag, one undo, with no special case anywhere. Asserted in the tests, because
 * it is a property of the history engine that this builder is depending on rather than a
 * coincidence it is enjoying.
 */

export const REPORT_SCHEMA_ID = 'report'
export const REPORT_SCHEMA_VERSION = 1

export const TILE_NODE = 'tile'

export interface PreservedReportFields {
  readonly id: string
  readonly title: string
}

export interface ReportSnapshot {
  readonly id: string
  readonly title: string
  readonly tiles: readonly Tile[]
}

export interface ReportDraft {
  readonly document: DocumentSnapshot
  readonly preserved: PreservedReportFields
}

export const HYDRATE_COVERAGE: Record<keyof ReportSnapshot, 'document' | 'preserved'> = {
  tiles: 'document',
  id: 'preserved',
  title: 'preserved',
}

const str = (props: Readonly<Record<string, unknown>>, key: string): string =>
  typeof props[key] === 'string' ? props[key] : ''

const num = (props: Readonly<Record<string, unknown>>, key: string, fallback: number): number =>
  typeof props[key] === 'number' && Number.isFinite(props[key]) ? props[key] : fallback

const contentFrom = (props: Readonly<Record<string, unknown>>): TileContent =>
  str(props, 'contentKind') === 'note'
    ? { kind: 'note', text: str(props, 'text') }
    : {
        kind: 'indicator',
        indicatorKind: str(props, 'indicatorKind'),
        fallbackLabel: str(props, 'fallbackLabel'),
      }

const propsFrom = (content: TileContent): Record<string, unknown> =>
  content.kind === 'note'
    ? { contentKind: 'note', text: content.text, indicatorKind: '', fallbackLabel: '' }
    : {
        contentKind: 'indicator',
        text: '',
        indicatorKind: content.indicatorKind,
        fallbackLabel: content.fallbackLabel,
      }

export const hydrate = (snapshot: ReportSnapshot): ReportDraft => {
  const document = emptyDocument(REPORT_SCHEMA_ID, REPORT_SCHEMA_VERSION)

  const nodes: Record<string, Node> = {}
  const childIds: Record<string, readonly NodeId[]> = {}
  const rootIds: NodeId[] = []

  // NOT sorted. `rootIds` order is paint order here, and the snapshot's order is what the coach
  // arranged — reordering it would silently change what is drawn on top.
  for (const tile of snapshot.tiles) {
    const nodeId = tile.id as NodeId
    nodes[nodeId] = {
      id: nodeId,
      type: TILE_NODE,
      props: {
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        ...propsFrom(tile.content),
      },
    }
    childIds[nodeId] = []
    rootIds.push(nodeId)
  }

  return {
    document: { ...document, nodes, childIds, rootIds },
    preserved: { id: snapshot.id, title: snapshot.title },
  }
}

export const commit = (draft: ReportDraft): ReportSnapshot => ({
  ...draft.preserved,
  tiles: draft.document.rootIds.map((nodeId) => {
    const props = draft.document.nodes[nodeId]?.props ?? {}
    return {
      id: nodeId,
      x: num(props, 'x', 0),
      y: num(props, 'y', 0),
      width: num(props, 'width', 200),
      height: num(props, 'height', 120),
      content: contentFrom(props),
    }
  }),
})

/**
 * A tile's rect, for the spatial index.
 *
 * Read from props rather than stored alongside them: the index is DERIVED from the document, and
 * a second copy of a tile's position would drift the first time a drag updated one and not the
 * other — the same reason a block's order is not a field.
 */
export const rectOfNode = (props: Readonly<Record<string, unknown>>): DocumentRect =>
  documentRect(num(props, 'x', 0), num(props, 'y', 0), num(props, 'width', 200), num(props, 'height', 120))

/** Nothing to normalise: a report has no derived field, so a round trip must be exact. */
export const normalize = (snapshot: ReportSnapshot): ReportSnapshot => snapshot
