/**
 * @fitnessos/editor-react — React bindings for the editor engine.
 *
 * A separate package from `editor-engine`, which is framework-free by rule
 * (`no-react-in-logic`), and separate from `packages/ui`, which every route loads — editor code
 * belongs only in the routes that host a builder.
 *
 * The store is vanilla and lives outside React. Components read it through `useSyncExternalStore`,
 * on TWO independent channels: the document (committed, undoable) and ephemeral state (drag,
 * hover, selection). Keeping those apart is what stops a drag from writing two hundred undo
 * entries or re-rendering a two-thousand-node tree sixty times a second.
 */

export { createEditorStore, type DispatchOptions, type EditorStore, type EditorStoreConfig, type Ephemeral } from './store'

export {
  EditorStoreProvider,
  useChildIds,
  useDocument,
  useEditorStore,
  useEphemeral,
  useHistoryControls,
  useIsSelected,
  useNode,
  useSelection,
  type HistoryControls,
} from './hooks'
