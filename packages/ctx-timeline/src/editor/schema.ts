import { emptyDocument, type DocumentSnapshot, type Node, type NodeId } from '@fitnessos/editor-engine'
import type { GoalId, PlainDate } from '@fitnessos/kernel'
import type { Phase } from '../domain/Plan'
import type { Span } from '../topology/temporal'

/**
 * The Timeline Builder's document schema (handbook D-09).
 *
 * The fifth editor, and the third kind of coordinate the engine has carried without changing:
 * row index, pixels, grid cells, and now day offsets. The document is still a flat record of
 * nodes; a phase's `start` and `length` are props, exactly as a tile's `x` and `y` are.
 *
 * ## The epoch is preserved, not editable
 *
 * Every phase offset is relative to it, so changing it shifts the whole plan. That is a
 * legitimate operation — "start this block a fortnight later" — and it is a COMMAND over the plan
 * rather than a property to nudge in the canvas, because dragging one number and silently moving
 * twelve phases is not something a coach can predict from the gesture.
 */

export const TIMELINE_SCHEMA_ID = 'plan'
export const TIMELINE_SCHEMA_VERSION = 1

export const PHASE_NODE = 'phase'

export interface PreservedPlanFields {
  readonly id: string
  readonly title: string
  readonly epoch: PlainDate
}

export interface PlanSnapshot {
  readonly id: string
  readonly title: string
  readonly epoch: PlainDate
  readonly phases: readonly Phase[]
}

export interface PlanDraft {
  readonly document: DocumentSnapshot
  readonly preserved: PreservedPlanFields
}

export const HYDRATE_COVERAGE: Record<keyof PlanSnapshot, 'document' | 'preserved'> = {
  phases: 'document',
  id: 'preserved',
  title: 'preserved',
  epoch: 'preserved',
}

const str = (props: Readonly<Record<string, unknown>>, key: string): string =>
  typeof props[key] === 'string' ? props[key] : ''

const num = (props: Readonly<Record<string, unknown>>, key: string, fallback: number): number =>
  typeof props[key] === 'number' && Number.isFinite(props[key]) ? props[key] : fallback

/** Null on the wire and in the aggregate; the empty string in props. Undone here. */
const optional = (value: string): string | null => (value === '' ? null : value)

export const hydrate = (snapshot: PlanSnapshot): PlanDraft => {
  const document = emptyDocument(TIMELINE_SCHEMA_ID, TIMELINE_SCHEMA_VERSION)

  const nodes: Record<string, Node> = {}
  const childIds: Record<string, readonly NodeId[]> = {}
  const rootIds: NodeId[] = []

  // Sorted by start, because time has an order and the document's sequence should read the way
  // the plan does. Unlike a grid, where the list carries nothing.
  for (const phase of [...snapshot.phases].sort((a, b) => a.start - b.start)) {
    const nodeId = phase.id as NodeId
    nodes[nodeId] = {
      id: nodeId,
      type: PHASE_NODE,
      props: {
        label: phase.label,
        start: phase.start,
        length: phase.length,
        // Empty string rather than null: `SetProperty` addresses a key, and a prop that is
        // sometimes absent makes "clear this field" and "never had one" the same edit.
        programId: phase.programId ?? '',
        servesGoal: phase.servesGoal ?? '',
      },
    }
    childIds[nodeId] = []
    rootIds.push(nodeId)
  }

  return {
    document: { ...document, nodes, childIds, rootIds },
    preserved: { id: snapshot.id, title: snapshot.title, epoch: snapshot.epoch },
  }
}

export const commit = (draft: PlanDraft): PlanSnapshot => ({
  ...draft.preserved,
  phases: draft.document.rootIds.map((nodeId) => {
    const props = draft.document.nodes[nodeId]?.props ?? {}
    return {
      id: nodeId,
      label: str(props, 'label'),
      start: Math.round(num(props, 'start', 0)),
      length: Math.round(num(props, 'length', 28)),
      programId: optional(str(props, 'programId')),
      servesGoal: optional(str(props, 'servesGoal')) as GoalId | null,
    }
  }),
})

/** A phase's span, derived from props. Never a second copy — see the report schema's note. */
export const spanOfNode = (props: Readonly<Record<string, unknown>>): Span => ({
  start: Math.round(num(props, 'start', 0)),
  length: Math.round(num(props, 'length', 28)),
})

/** Every OTHER phase's span, which is what the topology functions need to check a move against. */
export const otherSpans = (draft: PlanDraft, exclude: NodeId): readonly Span[] =>
  draft.document.rootIds
    .filter((id) => id !== exclude)
    .map((id) => spanOfNode(draft.document.nodes[id]?.props ?? {}))

/**
 * Nothing derived, so a round trip must be exact — except the ORDER.
 *
 * `hydrate` sorts by start, so a snapshot that arrived out of sequence commits sorted. That is
 * the one normalisation, and it is the same shape of thing as a programme's derived block order.
 */
export const normalize = (snapshot: PlanSnapshot): PlanSnapshot => ({
  ...snapshot,
  phases: [...snapshot.phases].sort((a, b) => a.start - b.start),
})
