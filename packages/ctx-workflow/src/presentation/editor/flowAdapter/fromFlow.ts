import type { EditorAction, NodeId } from '@fitnessos/editor-engine'
import { edgesTouching, type OutputPort, type WorkflowGraph } from '../../../domain/Workflow'
import { EDGE_NODE } from '../../../editor/schema'
import { canConnect, type ConnectionVerdict } from '../../../topology/graph'

/**
 * React Flow events → `EditorAction[]` (handbook D-11).
 *
 * The other direction of the adapter, and the reason React Flow never becomes the source of truth:
 * nothing it reports is applied by it. Every event is translated into actions, dispatched through
 * the store, and comes back as a new document — so undo, redo and the commit boundary see a drag on
 * a canvas exactly as they see a keystroke in a text field.
 *
 * These are pure functions returning arrays. That is what makes them testable without a canvas,
 * and jsdom cannot give us a canvas: React Flow measures nodes with `getBoundingClientRect`, which
 * returns zeros there. The geometry is asserted in Playwright; the TRANSLATION is asserted here.
 */

/** A position React Flow reports after a drag. Flow coordinates, pre-viewport-transform. */
export interface FlowPosition {
  readonly x: number
  readonly y: number
}

/**
 * One drag → two property writes, as ONE history entry.
 *
 * A batch rather than two dispatches. The Report Builder does this with two `dispatch` calls
 * carrying the same label and relies on coalescing to merge them, which works — and which also
 * means the merge depends on both landing inside the coalescing window. A batch states the
 * intent instead of arranging for it, and `pushBatch` never coalesces with a neighbour, so a drag
 * can never be swallowed into the edit before it.
 *
 * Rounded, because React Flow reports sub-pixel positions from a pointer drag and a coordinate of
 * `312.00000000000006` is noise that makes every saved payload differ from the last.
 */
export const moveActions = (nodeId: string, position: FlowPosition): readonly EditorAction[] => [
  { type: 'SetProperty', nodeId: nodeId as NodeId, key: 'x', value: Math.round(position.x) },
  { type: 'SetProperty', nodeId: nodeId as NodeId, key: 'y', value: Math.round(position.y) },
]

/** What React Flow gives us on `onConnect`, reduced to what we need and validated. */
export interface AttemptedConnection {
  readonly source: string | null
  readonly target: string | null
  readonly sourceHandle: string | null
}

export type ConnectionOutcome =
  | { readonly ok: true; readonly actions: readonly EditorAction[] }
  | { readonly ok: false; readonly verdict: ConnectionVerdict }

/**
 * A connection gesture → an `InsertNode`, or a refusal.
 *
 * D-11: validate via `topology` legality, then dispatch or reject. The validation is NOT a
 * formality here — React Flow will happily draw any connection its handles allow, and `isValidConnection`
 * (which we also set) only prevents the drop. This is the authority, because a document can also be
 * changed by paste, by an undo landing somewhere unexpected, or by a future keyboard affordance.
 *
 * `newId` is passed in rather than generated here so the function stays pure and the test can
 * assert on an exact document.
 */
export const connectionActions = (
  graph: WorkflowGraph,
  attempt: AttemptedConnection,
  newId: string,
  index: number,
): ConnectionOutcome => {
  if (attempt.source === null || attempt.target === null) {
    // React Flow reports a connection dropped on empty canvas with a null target. Not an error, and
    // not something to tell the user off about — they let go in the wrong place.
    return { ok: false, verdict: { ok: false, refusal: 'missing-node' } }
  }

  const port = portFrom(attempt.sourceHandle)
  const verdict = canConnect(graph, {
    from: attempt.source,
    port,
    to: attempt.target,
  })
  if (!verdict.ok) return { ok: false, verdict }

  return {
    ok: true,
    actions: [
      {
        type: 'InsertNode',
        node: {
          id: newId as NodeId,
          type: EDGE_NODE,
          props: { from: attempt.source, port, to: attempt.target },
        },
        // Root level. Edges do not nest under the nodes they join — see the schema's note on why a
        // graph with fan-in cannot be held in `childIds`.
        parentId: null,
        index,
      },
    ],
  }
}

/**
 * A missing or unrecognised handle means the node's only output.
 *
 * React Flow reports `null` for a handle on a node that declares exactly one, which is the common
 * case for triggers and actions. Defaulting to `'out'` here rather than refusing keeps the single-handle
 * case from depending on a React Flow implementation detail — and `canConnect` still refuses `'out'`
 * on a condition, which is what makes the default safe rather than lenient.
 */
const portFrom = (handle: string | null): OutputPort =>
  handle === 'true' || handle === 'false' ? handle : 'out'

/**
 * Deleting a step → remove its edges AND the step, in one batch.
 *
 * Edges first. `RemoveNode` on the step alone would leave edges pointing at a node that no longer
 * exists, which `problemsOf` then reports as a dangling edge against a coach who did nothing wrong.
 * Order within the batch matters for the INVERSE as much as the forward pass: `pushBatch` prepends
 * each inverse, so undo re-inserts the step before the edges that reference it.
 */
export const deleteStepActions = (
  graph: WorkflowGraph,
  nodeId: string,
): readonly EditorAction[] => [
  ...edgesTouching(graph, nodeId).map(
    (edge): EditorAction => ({ type: 'RemoveNode', nodeId: edge.id as NodeId }),
  ),
  { type: 'RemoveNode', nodeId: nodeId as NodeId },
]

/** Deleting an edge. One action; there is nothing to cascade. */
export const deleteEdgeActions = (edgeId: string): readonly EditorAction[] => [
  { type: 'RemoveNode', nodeId: edgeId as NodeId },
]
