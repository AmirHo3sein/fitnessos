import { applyAction, invertAction, isStructural, targetsOf, type EditorAction } from '../document/actions'
import type { DocumentSnapshot } from '../document/snapshot'

/**
 * Inverse-action history with periodic checkpoints (handbook D-01).
 *
 * **Never snapshot-per-entry.** A 2,000-node document with 200 undo entries costs kilobytes as
 * inverse actions and hundreds of megabytes as snapshots. The trade is that undo replays work
 * instead of restoring state, which is why checkpoints exist: they bound how much replay any
 * single operation can require.
 */

export interface HistoryEntry {
  readonly id: string
  /** Shown in the UI — "Move 3 blocks". */
  readonly label: string
  readonly actions: readonly EditorAction[]
  /** Applied in REVERSE order. See `undo`. */
  readonly inverses: readonly EditorAction[]
  readonly at: number
  /**
   * A commit boundary cannot be undone past (D-01).
   *
   * Pushed when work is saved to the server. Undoing past it would put the local document in a
   * state the server has never seen and cannot be reconciled with — the user would be editing a
   * document that no longer corresponds to anything.
   */
  readonly boundary: boolean
}

export interface HistoryConfig {
  readonly maxEntries: number
  readonly checkpointEvery: number
  readonly coalesceWindowMs: number
}

export const DEFAULT_HISTORY_CONFIG: HistoryConfig = {
  maxEntries: 200,
  checkpointEvery: 50,
  coalesceWindowMs: 500,
}

interface Checkpoint {
  /** Index in `entries` this snapshot represents the state BEFORE. */
  readonly index: number
  readonly document: DocumentSnapshot
}

export interface HistoryState {
  readonly document: DocumentSnapshot
  readonly entries: readonly HistoryEntry[]
  /** How many entries are currently applied. Everything at or above this is redoable. */
  readonly cursor: number
  readonly checkpoints: readonly Checkpoint[]
  readonly config: HistoryConfig
}

export const createHistory = (
  document: DocumentSnapshot,
  config: HistoryConfig = DEFAULT_HISTORY_CONFIG,
): HistoryState => ({
  document,
  entries: [],
  cursor: 0,
  checkpoints: [{ index: 0, document }],
  config,
})

/**
 * Whether a new edit should merge into the previous entry.
 *
 * Typing into a field produces one action per keystroke, and a user who types "squat" means one
 * change, not five. Merging them is what makes undo behave the way people expect.
 *
 * Three conditions, all required, and the third is the one that matters most:
 *   - same action type
 *   - same targets
 *   - **not structural.** Two property edits a moment apart are one change; two insertions are
 *     not. An undo that removes two nodes when the user expected one is precisely how people
 *     learn to stop trusting undo.
 */
const shouldCoalesce = (
  previous: HistoryEntry,
  action: EditorAction,
  at: number,
  windowMs: number,
): boolean => {
  // A boundary must stay the newest entry until something is pushed after it; merging into it
  // would let an edit slip in behind the commit.
  if (previous.boundary) return false
  if (isStructural(action)) return false

  const last = previous.actions[previous.actions.length - 1]
  if (last === undefined || last.type !== action.type) return false
  if (at - previous.at >= windowMs) return false

  const a = targetsOf(last)
  const b = targetsOf(action)
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export interface PushOptions {
  readonly label: string
  readonly at: number
  readonly id: string
  readonly boundary?: boolean
}

export const push = (
  state: HistoryState,
  action: EditorAction,
  options: PushOptions,
): HistoryState => {
  // The inverse is computed against the document BEFORE the action — the only moment the
  // information it needs exists.
  const inverse = invertAction(state.document, action)
  const document = applyAction(state.document, action)

  // A new edit after an undo discards the redo branch. Keeping it would require a tree, and a
  // branching undo history is a feature almost no editor has because almost no user wants it.
  const kept = state.entries.slice(0, state.cursor)
  const previous = kept[kept.length - 1]

  if (previous !== undefined && shouldCoalesce(previous, action, options.at, state.config.coalesceWindowMs)) {
    const merged: HistoryEntry = {
      ...previous,
      actions: [...previous.actions, action],
      // Prepended: inverses are applied in reverse order, so the newest action's inverse must run
      // first. Appending here is the classic bug that makes a coalesced undo restore the wrong
      // intermediate value.
      inverses: [inverse, ...previous.inverses],
      at: options.at,
    }
    return {
      ...state,
      document,
      entries: [...kept.slice(0, -1), merged],
      cursor: kept.length,
    }
  }

  const entry: HistoryEntry = {
    id: options.id,
    label: options.label,
    actions: [action],
    inverses: [inverse],
    at: options.at,
    boundary: options.boundary ?? false,
  }

  const entries = [...kept, entry]
  const cursor = entries.length

  let checkpoints = state.checkpoints
  if (cursor % state.config.checkpointEvery === 0) {
    checkpoints = [...checkpoints, { index: cursor, document }]
  }

  return evict({ ...state, document, entries, cursor, checkpoints })
}

/**
 * Drop the oldest entries beyond the cap, keeping the nearest checkpoint at the truncation
 * boundary.
 *
 * Losing that checkpoint would make the oldest surviving entries un-redoable: redo replays forward
 * from a known state, and without one there is nothing to replay from.
 */
const evict = (state: HistoryState): HistoryState => {
  const excess = state.entries.length - state.config.maxEntries
  if (excess <= 0) return state

  const entries = state.entries.slice(excess)
  const cursor = Math.max(0, state.cursor - excess)

  const shifted = state.checkpoints
    .filter((checkpoint) => checkpoint.index >= excess)
    .map((checkpoint) => ({ ...checkpoint, index: checkpoint.index - excess }))

  // Always keep a checkpoint at 0. If eviction removed the last one below the boundary, the
  // document as it stands after replaying nothing is the new base.
  const hasZero = shifted.some((checkpoint) => checkpoint.index === 0)
  const checkpoints = hasZero
    ? shifted
    : [{ index: 0, document: replayTo(state, excess) }, ...shifted]

  return { ...state, entries, cursor, checkpoints }
}

/** The document as it was after `index` entries, rebuilt from the nearest checkpoint at or below. */
const replayTo = (state: HistoryState, index: number): DocumentSnapshot => {
  const base = [...state.checkpoints]
    .filter((checkpoint) => checkpoint.index <= index)
    .sort((a, b) => b.index - a.index)[0]

  let document = base?.document ?? state.document
  for (const entry of state.entries.slice(base?.index ?? 0, index)) {
    for (const action of entry.actions) document = applyAction(document, action)
  }
  return document
}

export const canUndo = (state: HistoryState): boolean => {
  if (state.cursor === 0) return false
  // A boundary blocks undo THROUGH it, not the boundary entry itself.
  return state.entries[state.cursor - 1]?.boundary !== true
}

export const canRedo = (state: HistoryState): boolean => state.cursor < state.entries.length

export const undo = (state: HistoryState): HistoryState => {
  const entry = state.entries[state.cursor - 1]
  if (!canUndo(state) || entry === undefined) return state

  // Inverses in order — they were stored newest-first when coalesced, which is what makes a
  // multi-action entry unwind in the right sequence.
  let document = state.document
  for (const inverse of entry.inverses) document = applyAction(document, inverse)

  return { ...state, document, cursor: state.cursor - 1 }
}

export const redo = (state: HistoryState): HistoryState => {
  const entry = state.entries[state.cursor]
  if (!canRedo(state) || entry === undefined) return state

  let document = state.document
  for (const action of entry.actions) document = applyAction(document, action)

  return { ...state, document, cursor: state.cursor + 1 }
}

/**
 * Mark everything up to now as committed.
 *
 * Pushed as a zero-action entry rather than a flag on the previous one, so a commit is a point in
 * the timeline even when nothing was edited since the last one.
 */
export const commitBoundary = (state: HistoryState, id: string, at: number): HistoryState => {
  const entry: HistoryEntry = {
    id,
    label: 'commit',
    actions: [],
    inverses: [],
    at,
    boundary: true,
  }
  const entries = [...state.entries.slice(0, state.cursor), entry]
  return evict({ ...state, entries, cursor: entries.length })
}
