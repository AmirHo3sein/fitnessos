import type { Branded } from '@fitnessos/kernel'

/**
 * The document every builder edits.
 *
 * **Flat and normalised, never nested** (handbook D-02). `nodes` is a record keyed by id;
 * parent/child structure lives in `childIds`, separately.
 *
 * That shape is not a preference, it is the reason edits are cheap. Immer clones the path it
 * writes to: on a flat record, setting one node's property clones one node and one record entry.
 * On a nested tree it clones every ancestor of the edited node — O(depth) allocation on every
 * keystroke, in a builder where a keystroke is the most common event there is.
 *
 * The cost is that traversal needs lookups. That is paid for with memoised child selectors, and
 * traversal never happens during render.
 */

export type NodeId = Branded<string, 'NodeId'>

export interface Node {
  readonly id: NodeId
  readonly type: string
  readonly props: Readonly<Record<string, unknown>>
}

export interface DocumentSnapshot<N extends Node = Node> {
  readonly nodes: Readonly<Record<NodeId, N>>
  readonly rootIds: readonly NodeId[]
  readonly childIds: Readonly<Record<NodeId, readonly NodeId[]>>
  readonly meta: { readonly schemaId: string; readonly schemaVersion: number }
}

export const emptyDocument = (schemaId: string, schemaVersion = 1): DocumentSnapshot => ({
  nodes: {},
  rootIds: [],
  childIds: {},
  meta: { schemaId, schemaVersion },
})

export const nodeAt = <N extends Node>(doc: DocumentSnapshot<N>, id: NodeId): N | null =>
  doc.nodes[id] ?? null

export const childrenOf = <N extends Node>(
  doc: DocumentSnapshot<N>,
  id: NodeId,
): readonly NodeId[] => doc.childIds[id] ?? []

/**
 * The parent of a node, or null for a root.
 *
 * A scan rather than a stored `parentId`, deliberately. A stored parent is a second source of
 * truth for the same fact, and the two drift the first time a reparent updates one and not the
 * other — producing a tree where a node's parent does not list it as a child. If this ever shows
 * up in a profile, the fix is a derived index rebuilt on structural change, NOT a field on the
 * node.
 */
export const parentOf = <N extends Node>(
  doc: DocumentSnapshot<N>,
  id: NodeId,
): NodeId | null => {
  for (const [parent, children] of Object.entries(doc.childIds)) {
    if (children.includes(id)) return parent as NodeId
  }
  return null
}

/** Depth-first ids, roots first. Order is the document's own order. */
export const walk = <N extends Node>(doc: DocumentSnapshot<N>): readonly NodeId[] => {
  const out: NodeId[] = []
  const visit = (id: NodeId) => {
    out.push(id)
    for (const child of childrenOf(doc, id)) visit(child)
  }
  for (const root of doc.rootIds) visit(root)
  return out
}

/**
 * Every descendant of a node, excluding the node itself.
 *
 * Needed by removal: deleting a node must remove its whole subtree, and the INVERSE of that
 * deletion has to restore the subtree exactly — which means the action has to capture it.
 */
export const descendantsOf = <N extends Node>(
  doc: DocumentSnapshot<N>,
  id: NodeId,
): readonly NodeId[] => {
  const out: NodeId[] = []
  const visit = (current: NodeId) => {
    for (const child of childrenOf(doc, current)) {
      out.push(child)
      visit(child)
    }
  }
  visit(id)
  return out
}
