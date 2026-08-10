import { produce } from 'immer'
import {
  childrenOf,
  descendantsOf,
  parentOf,
  type DocumentSnapshot,
  type Node,
  type NodeId,
} from './snapshot'

/**
 * Editor actions, and the registry that makes every one of them invertible.
 *
 * Handbook D-01: history is inverse-action, not snapshot-per-entry. A 2,000-node document with
 * 200 undo entries costs kilobytes rather than hundreds of megabytes — but only if every action
 * can be reversed, so **an action without an inverter must not compile**.
 *
 * That is enforced by `ACTIONS` below being typed `Record<EditorAction['type'], Handler>`. Adding
 * a variant to the union without adding a handler is a type error at one line. There is no
 * runtime check, no default case, and no way to register a half-implemented action.
 *
 * ## Why inverters capture state rather than recompute it
 *
 * `RemoveNode` carries the removed nodes and their position. It would be smaller to store just the
 * id and recompute on undo — and it would be wrong, because by the time undo runs the document has
 * changed and the information needed to restore is gone. An inverse must be a complete instruction,
 * not a hint.
 */

export interface SetProperty {
  readonly type: 'SetProperty'
  readonly nodeId: NodeId
  readonly key: string
  readonly value: unknown
}

export interface InsertNode {
  readonly type: 'InsertNode'
  readonly node: Node
  /** Null inserts at root level. */
  readonly parentId: NodeId | null
  readonly index: number
}

export interface RemoveNode {
  readonly type: 'RemoveNode'
  readonly nodeId: NodeId
}

/**
 * The inverse of `RemoveNode` — and a real member of the union, not a cast.
 *
 * An earlier draft had `RemoveNode.invert` fabricate an `InsertSubtree` object and assert it into
 * `EditorAction`. That cast would have compiled and then failed at runtime the first time anyone
 * undid a deletion, because `applyAction` would have looked up a handler that did not exist. The
 * registry's whole guarantee is that every action has a handler; an action smuggled in by
 * assertion defeats it silently.
 *
 * The subtree is captured at removal time. Recomputing it on undo is impossible: by then the nodes
 * are gone and there is nothing left to compute from.
 */
export interface InsertSubtree {
  readonly type: 'InsertSubtree'
  readonly rootId: NodeId
  readonly nodes: readonly Node[]
  readonly childIds: Readonly<Record<NodeId, readonly NodeId[]>>
  readonly parentId: NodeId | null
  readonly index: number
}

export interface NodePosition {
  readonly nodeId: NodeId
  readonly parentId: NodeId | null
  readonly index: number
}

export interface MoveNodes {
  readonly type: 'MoveNodes'
  readonly nodeIds: readonly NodeId[]
  readonly toParentId: NodeId | null
  readonly toIndex: number
}

/**
 * The inverse of `MoveNodes`, carrying a position PER NODE.
 *
 * `MoveNodes` sends everything to one parent at one index, which cannot express the reverse of a
 * multi-select drag: three nodes taken from three different parents have three different homes to
 * return to. Trying to invert a move with another move loses that, and the first draft did — it
 * returned index 0 for every node, so undoing a multi-select drag scrambled the document.
 */
export interface RestorePositions {
  readonly type: 'RestorePositions'
  readonly positions: readonly NodePosition[]
}

export type EditorAction =
  | SetProperty
  | InsertNode
  | RemoveNode
  | InsertSubtree
  | MoveNodes
  | RestorePositions

/**
 * Actions that change the document's SHAPE rather than a value.
 *
 * Structural actions never coalesce (D-01). Merging two property edits a moment apart is what a
 * user means by "one change"; merging two insertions is not, and an undo that removes two nodes
 * when the user expected one is the kind of thing that makes people stop trusting undo.
 */
export const isStructural = (action: EditorAction): boolean => action.type !== 'SetProperty'

/** The ids an action touches. Used by coalescing to decide whether two edits are "the same edit". */
export const targetsOf = (action: EditorAction): readonly NodeId[] => {
  switch (action.type) {
    case 'SetProperty':
      return [action.nodeId]
    case 'InsertNode':
      return [action.node.id]
    case 'RemoveNode':
      return [action.nodeId]
    case 'InsertSubtree':
      return [action.rootId]
    case 'MoveNodes':
      return action.nodeIds
    case 'RestorePositions':
      return action.positions.map((position) => position.nodeId)
  }
}

interface Handler<A extends EditorAction> {
  readonly apply: (doc: DocumentSnapshot, action: A) => DocumentSnapshot
  /**
   * The action that undoes this one, computed against the document BEFORE it is applied.
   *
   * Before, not after, because the information an inverse needs — the previous property value, the
   * removed subtree, the old position — only exists beforehand.
   */
  readonly invert: (doc: DocumentSnapshot, action: A) => EditorAction
}

const listWithout = (list: readonly NodeId[], id: NodeId): NodeId[] =>
  list.filter((candidate) => candidate !== id)

const listWith = (list: readonly NodeId[], id: NodeId, index: number): NodeId[] => {
  const next = [...list]
  next.splice(Math.max(0, Math.min(index, next.length)), 0, id)
  return next
}

/** Where a node currently sits. The unit an inverse needs to put it back. */
const positionOf = (doc: DocumentSnapshot, nodeId: NodeId): NodePosition => {
  const parentId = parentOf(doc, nodeId)
  const siblings = parentId === null ? doc.rootIds : childrenOf(doc, parentId)
  return { nodeId, parentId, index: siblings.indexOf(nodeId) }
}

/**
 * Every action, with its inverse.
 *
 * The `Record` type is the enforcement: a new member of `EditorAction` that is not present here is
 * a compile error, so an action can never reach history without a way back.
 */
const ACTIONS: { [K in EditorAction['type']]: Handler<Extract<EditorAction, { type: K }>> } = {
  SetProperty: {
    apply: (doc, action) =>
      produce(doc, (draft) => {
        const node = draft.nodes[action.nodeId]
        if (node === undefined) return
        node.props[action.key] = action.value
      }),
    invert: (doc, action) => ({
      type: 'SetProperty',
      nodeId: action.nodeId,
      key: action.key,
      // The value it had before. `undefined` is a legitimate previous value and round-trips
      // correctly, because the inverse sets it back to undefined rather than deleting the key.
      value: doc.nodes[action.nodeId]?.props[action.key],
    }),
  },

  InsertNode: {
    apply: (doc, action) =>
      produce(doc, (draft) => {
        draft.nodes[action.node.id] = { ...action.node, props: { ...action.node.props } }
        draft.childIds[action.node.id] ??= []
        if (action.parentId === null) {
          draft.rootIds = listWith(draft.rootIds, action.node.id, action.index)
        } else {
          draft.childIds[action.parentId] = listWith(
            draft.childIds[action.parentId] ?? [],
            action.node.id,
            action.index,
          )
        }
      }),
    invert: (_doc, action) => ({ type: 'RemoveNode', nodeId: action.node.id }),
  },

  RemoveNode: {
    apply: (doc, action) =>
      produce(doc, (draft) => {
        const parent = parentOf(doc, action.nodeId)
        const removing = new Set<string>([action.nodeId, ...descendantsOf(doc, action.nodeId)])

        // Rebuilt without the removed keys rather than `delete draft.nodes[id]`. Dynamic delete on
        // a record is usually a sign the structure wanted to be a Map, and the lint rule is right
        // to ask; here the record is correct (it is serialised, and Immer handles it structurally)
        // so the filter is the honest way to express the same thing.
        draft.nodes = Object.fromEntries(
          Object.entries(draft.nodes).filter(([key]) => !removing.has(key)),
        )
        draft.childIds = Object.fromEntries(
          Object.entries(draft.childIds).filter(([key]) => !removing.has(key)),
        )

        if (parent === null) draft.rootIds = listWithout(draft.rootIds, action.nodeId)
        else draft.childIds[parent] = listWithout(draft.childIds[parent] ?? [], action.nodeId)
      }),
    invert: (doc, action) => {
      // Captured NOW, while the subtree still exists. This is the only moment it can be.
      const subtree = [action.nodeId, ...descendantsOf(doc, action.nodeId)]
      const nodes = subtree
        .map((id) => doc.nodes[id])
        .filter((node): node is Node => node !== undefined)

      const childIds: Record<string, readonly NodeId[]> = {}
      for (const id of subtree) childIds[id] = childrenOf(doc, id)

      const parent = parentOf(doc, action.nodeId)
      const siblings = parent === null ? doc.rootIds : childrenOf(doc, parent)

      return {
        type: 'InsertSubtree',
        rootId: action.nodeId,
        nodes,
        childIds,
        parentId: parent,
        index: siblings.indexOf(action.nodeId),
      }
    },
  },

  InsertSubtree: {
    apply: (doc, action) =>
      produce(doc, (draft) => {
        for (const node of action.nodes) {
          draft.nodes[node.id] = { ...node, props: { ...node.props } }
        }
        for (const [id, children] of Object.entries(action.childIds)) {
          draft.childIds[id as NodeId] = [...children]
        }
        if (action.parentId === null) {
          draft.rootIds = listWith(draft.rootIds, action.rootId, action.index)
        } else {
          draft.childIds[action.parentId] = listWith(
            draft.childIds[action.parentId] ?? [],
            action.rootId,
            action.index,
          )
        }
      }),
    invert: (_doc, action) => ({ type: 'RemoveNode', nodeId: action.rootId }),
  },

  MoveNodes: {
    apply: (doc, action) =>
      produce(doc, (draft) => {
        for (const [offset, nodeId] of action.nodeIds.entries()) {
          const currentParent = parentOf(doc, nodeId)
          if (currentParent === null) draft.rootIds = listWithout(draft.rootIds, nodeId)
          else {
            draft.childIds[currentParent] = listWithout(draft.childIds[currentParent] ?? [], nodeId)
          }

          if (action.toParentId === null) {
            draft.rootIds = listWith(draft.rootIds, nodeId, action.toIndex + offset)
          } else {
            draft.childIds[action.toParentId] = listWith(
              draft.childIds[action.toParentId] ?? [],
              nodeId,
              action.toIndex + offset,
            )
          }
        }
      }),
    // A move is inverted by RESTORING positions, not by another move — see the note on
    // RestorePositions.
    invert: (doc, action) => ({
      type: 'RestorePositions',
      positions: action.nodeIds.map((nodeId) => positionOf(doc, nodeId)),
    }),
  },

  RestorePositions: {
    apply: (doc, action) =>
      produce(doc, (draft) => {
        for (const position of action.positions) {
          const currentParent = parentOf(doc, position.nodeId)
          if (currentParent === null) draft.rootIds = listWithout(draft.rootIds, position.nodeId)
          else {
            draft.childIds[currentParent] = listWithout(
              draft.childIds[currentParent] ?? [],
              position.nodeId,
            )
          }

          if (position.parentId === null) {
            draft.rootIds = listWith(draft.rootIds, position.nodeId, position.index)
          } else {
            draft.childIds[position.parentId] = listWith(
              draft.childIds[position.parentId] ?? [],
              position.nodeId,
              position.index,
            )
          }
        }
      }),
    invert: (doc, action) => ({
      type: 'RestorePositions',
      positions: action.positions.map((position) => positionOf(doc, position.nodeId)),
    }),
  },
}

export const applyAction = (doc: DocumentSnapshot, action: EditorAction): DocumentSnapshot => {
  const handler = ACTIONS[action.type] as Handler<EditorAction>
  return handler.apply(doc, action)
}

export const invertAction = (doc: DocumentSnapshot, action: EditorAction): EditorAction => {
  const handler = ACTIONS[action.type] as Handler<EditorAction>
  return handler.invert(doc, action)
}
