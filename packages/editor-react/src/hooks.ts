'use client'

import { createDiContext } from '@fitnessos/ui'
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import type { DocumentSnapshot, Node, NodeId } from '@fitnessos/editor-engine'
import type { EditorStore, Ephemeral } from './store'

/**
 * React bindings for the editor store.
 *
 * `useSyncExternalStore`, not `useState`. The store lives outside React because pointer handlers
 * and animation frames drive it; this is the sanctioned way to read such a store without tearing
 * during a concurrent render.
 */

const editorDi = createDiContext<EditorStore>('Editor')

// Bound to locals first: `export { x as y }` re-exports without creating a local binding, so the
// hooks below could not call it.
export const EditorStoreProvider = editorDi.Provider
export const useEditorStore = editorDi.useDi

/**
 * Subscribe to a slice of external state.
 *
 * **The cached `Object.is` comparison is not an optimisation — it is required for correctness.**
 * `useSyncExternalStore` calls `getSnapshot` on every render and throws
 * "The result of getSnapshot should be cached to avoid an infinite loop" if the value is not
 * referentially stable. A selector that builds an object (`{ x, y }`) returns a new reference each
 * call and hangs the app.
 *
 * Slices of the document are naturally stable — Immer preserves the identity of anything it did
 * not touch, which is what makes `useNode` re-render only when THAT node changed. Derived objects
 * are not, so the cache below makes the unsafe case safe rather than relying on every caller to
 * remember.
 */
const useStoreSlice = <T>(
  subscribe: (listener: () => void) => () => void,
  read: () => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T => {
  const cache = useRef<{ value: T } | null>(null)

  const getSnapshot = useCallback(() => {
    const next = read()
    if (cache.current === null || !isEqual(cache.current.value, next)) {
      cache.current = { value: next }
    }
    return cache.current.value
  }, [read, isEqual])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Shallow array equality, for selectors that return a list of ids. */
const sameIds = (a: readonly NodeId[], b: readonly NodeId[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index])

export const useDocument = (): DocumentSnapshot => {
  const store = useEditorStore()
  return useStoreSlice(store.subscribe, () => store.getState().document)
}

/**
 * One node.
 *
 * Re-renders only when THAT node changes, because Immer gives every untouched node the same
 * reference across an edit. This is the payoff of the flat normalised document (D-02): editing one
 * node in a 2,000-node tree re-renders one component.
 */
export const useNode = (id: NodeId): Node | null => {
  const store = useEditorStore()
  return useStoreSlice(store.subscribe, () => store.getState().document.nodes[id] ?? null)
}

export const useChildIds = (id: NodeId | null): readonly NodeId[] => {
  const store = useEditorStore()
  const read = useCallback(() => {
    const document = store.getState().document
    return id === null ? document.rootIds : (document.childIds[id] ?? [])
  }, [store, id])
  return useStoreSlice(store.subscribe, read, sameIds)
}

/**
 * Ephemeral state — drag, hover, selection.
 *
 * A separate channel from the document, so a drag at 60fps notifies only the components that asked
 * about dragging. A component reading this does NOT re-render when the document changes, and vice
 * versa.
 */
export const useEphemeral = <T>(
  select: (ephemeral: Ephemeral) => T,
  isEqual?: (a: T, b: T) => boolean,
): T => {
  const store = useEditorStore()
  const read = useCallback(() => select(store.getEphemeral()), [store, select])
  return useStoreSlice(store.subscribeEphemeral, read, isEqual)
}

export const useSelection = (): readonly NodeId[] =>
  useEphemeral((ephemeral) => ephemeral.selected, sameIds)

export const useIsSelected = (id: NodeId): boolean =>
  useEphemeral((ephemeral) => ephemeral.selected.includes(id))

export interface HistoryControls {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undo: () => void
  readonly redo: () => void
  readonly commit: () => void
}

export const useHistoryControls = (): HistoryControls => {
  const store = useEditorStore()
  const canUndo = useStoreSlice(store.subscribe, () => store.canUndo())
  const canRedo = useStoreSlice(store.subscribe, () => store.canRedo())

  return useMemo(
    () => ({ canUndo, canRedo, undo: store.undo, redo: store.redo, commit: store.commit }),
    [canUndo, canRedo, store],
  )
}
