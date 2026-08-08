/**
 * @fitnessos/editor-engine — the document, history and geometry engine behind every builder.
 *
 * Framework-free by rule (`no-react-in-logic`): no React, no DOM, no rendering. It owns the
 * document, the actions, undo/redo and spatial queries; a builder owns presentation and wires the
 * two together. React Flow, when the Workflow Builder needs it, owns rendering only and is never
 * the source of truth (D-11).
 *
 * What is here: D-01 history, D-02 flat document, D-03 spatial index, D-04 coordinate spaces.
 * What is not, yet: nested sub-documents (D-07), cross-document references (D-08), and the React
 * bindings. Each is a real piece of design rather than a file, and none is needed to build the
 * first builder on top of this.
 */

export {
  childrenOf,
  descendantsOf,
  emptyDocument,
  nodeAt,
  parentOf,
  walk,
  type DocumentSnapshot,
  type Node,
  type NodeId,
} from './document/snapshot'

export {
  applyAction,
  invertAction,
  isStructural,
  targetsOf,
  type EditorAction,
  type InsertNode,
  type InsertSubtree,
  type MoveNodes,
  type NodePosition,
  type RemoveNode,
  type RestorePositions,
  type SetProperty,
} from './document/actions'

export {
  DEFAULT_HISTORY_CONFIG,
  canRedo,
  canUndo,
  commitBoundary,
  createHistory,
  push,
  redo,
  undo,
  type HistoryConfig,
  type HistoryEntry,
  type HistoryState,
  type PushOptions,
} from './history/history'

export {
  clientPoint,
  documentPoint,
  documentRect,
  fromClient,
  rectContains,
  rectToScreen,
  rectsOverlap,
  screenPixels,
  screenPoint,
  thresholdInDocument,
  toDocument,
  toScreen,
  type ClientPoint,
  type DocumentPoint,
  type DocumentRect,
  type ScreenPixels,
  type ScreenPoint,
  type ScreenRect,
  type Viewport,
} from './geometry/spaces'

export { SpatialHash } from './geometry/spatialHash'
