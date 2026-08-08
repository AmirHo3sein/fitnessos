import {
  canRedo as engineCanRedo,
  canUndo as engineCanUndo,
  commitBoundary,
  createHistory,
  push,
  redo as engineRedo,
  undo as engineUndo,
  type DocumentSnapshot,
  type EditorAction,
  type HistoryConfig,
  type HistoryState,
  type NodeId,
} from '@fitnessos/editor-engine'

/**
 * The editor store. Vanilla — no React, no hooks, no imports from `react`.
 *
 * Deliberately outside React because the things that drive an editor are not React events. A
 * pointer-move handler, a `requestAnimationFrame` loop and a keyboard shortcut all need to read
 * and write editor state, and routing every one of them through `useState` means a re-render per
 * frame of a drag.
 *
 * ## Two channels, and this is the central design decision
 *
 * **Committed** — the document and its history. Every change is an action, is undoable, and
 * notifies document subscribers.
 *
 * **Ephemeral** — the drag offset, the hover target, the marquee rectangle. Changes sixty times a
 * second, must never create a history entry, and must never re-render the document tree.
 *
 * Collapsing them is the single most damaging thing that can be done to an editor. Put the drag
 * offset in the document and every mouse move becomes an undo entry, so the user presses Ctrl-Z
 * two hundred times to reverse one drag; put it in a single React state and every mouse move
 * re-renders every node. Separate subscriber lists mean a drag notifies only the components that
 * care about dragging.
 */

export interface Ephemeral {
  /** Nodes under an active drag, and how far they have moved. Never in the document. */
  readonly dragging: readonly NodeId[]
  readonly dragOffset: { readonly x: number; readonly y: number } | null
  readonly hovered: NodeId | null
  /** Selection is ephemeral: it is not part of the document and is not undoable. */
  readonly selected: readonly NodeId[]
}

const EMPTY_EPHEMERAL: Ephemeral = {
  dragging: [],
  dragOffset: null,
  hovered: null,
  selected: [],
}

export interface DispatchOptions {
  readonly label: string
  readonly boundary?: boolean
}

export interface EditorStore {
  readonly getState: () => HistoryState
  readonly subscribe: (listener: () => void) => () => void

  readonly getEphemeral: () => Ephemeral
  readonly subscribeEphemeral: (listener: () => void) => () => void

  readonly dispatch: (action: EditorAction, options: DispatchOptions) => void
  readonly setEphemeral: (patch: Partial<Ephemeral>) => void

  readonly undo: () => void
  readonly redo: () => void
  readonly commit: () => void

  readonly canUndo: () => boolean
  readonly canRedo: () => boolean
}

export interface EditorStoreConfig {
  readonly document: DocumentSnapshot
  readonly history?: HistoryConfig
  /**
   * Injected rather than read from `Date.now()`, so a test can drive coalescing deterministically.
   * Coalescing is time-based, and a test that depends on the real clock is a test that fails on a
   * slow machine.
   */
  readonly now?: () => number
  readonly newId?: () => string
}

export const createEditorStore = (config: EditorStoreConfig): EditorStore => {
  let state = createHistory(config.document, config.history)
  let ephemeral = EMPTY_EPHEMERAL

  const listeners = new Set<() => void>()
  const ephemeralListeners = new Set<() => void>()

  const now = config.now ?? (() => Date.now())
  let counter = 0
  const newId = config.newId ?? (() => `e${String(counter++)}`)

  const notify = () => {
    for (const listener of listeners) listener()
  }
  const notifyEphemeral = () => {
    for (const listener of ephemeralListeners) listener()
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    getEphemeral: () => ephemeral,
    subscribeEphemeral: (listener) => {
      ephemeralListeners.add(listener)
      return () => ephemeralListeners.delete(listener)
    },

    dispatch: (action, options) => {
      state = push(state, action, {
        label: options.label,
        at: now(),
        id: newId(),
        ...(options.boundary === undefined ? {} : { boundary: options.boundary }),
      })
      notify()
    },

    setEphemeral: (patch) => {
      ephemeral = { ...ephemeral, ...patch }
      // Only the ephemeral channel. A drag must not wake the document tree.
      notifyEphemeral()
    },

    undo: () => {
      const next = engineUndo(state)
      if (next === state) return
      state = next
      notify()
    },
    redo: () => {
      const next = engineRedo(state)
      if (next === state) return
      state = next
      notify()
    },
    commit: () => {
      state = commitBoundary(state, newId(), now())
      notify()
    },

    canUndo: () => engineCanUndo(state),
    canRedo: () => engineCanRedo(state),
  }
}
