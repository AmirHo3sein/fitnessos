import {
  emptyDocument,
  type DocumentSnapshot,
  type Node,
  type NodeId,
} from '@fitnessos/editor-engine'
import type { AnswerShape, FormField } from '../domain/CheckInForm'

/**
 * The Form Builder's document schema, and its hydrate/commit pair (handbook D-09).
 *
 * ## What this file is really for
 *
 * It is the SECOND consumer of `editor-engine`. The first was the Program Builder, and the whole
 * argument for extracting an engine before writing five builders was that the second one would
 * find whatever the first got wrong. So the question this file answers is not "can a form be
 * edited" — it is "what did the engine have to change to allow it".
 *
 * The answer, recorded because a null result is still a result: **nothing**. The document is a
 * flat record of nodes with order carried by `rootIds`, exactly as a programme is. Fields differ
 * from blocks in what their props mean, not in how they are stored, and `props` being
 * `Record<string, unknown>` is what absorbs the difference. The engine is unchanged.
 *
 * ## Where the two builders genuinely differ
 *
 * A field's `answer` is a closed sum type whose variants carry different fields — a scale has
 * bounds, a choice has options. The document cannot hold a discriminated union in a prop and
 * stay serialisable in a way `SetProperty` can address, so it is FLATTENED: `answerKind`,
 * `scaleMin`, `scaleMax`, `options`. Commit reassembles it.
 *
 * That flattening is the interesting cost, and it is paid deliberately. The alternative — one
 * prop holding the whole union object — would make changing a scale's minimum a `SetProperty`
 * that replaces the entire answer shape, so undo would restore the whole thing rather than the
 * one number, and coalescing could never merge two adjustments of the same bound.
 */

export const FORM_SCHEMA_ID = 'check-in-form'
export const FORM_SCHEMA_VERSION = 1

export const FIELD_NODE = 'field'

/** Fields the builder does not edit, carried through a round trip untouched. */
export interface PreservedFormFields {
  readonly id: string
  readonly title: string
}

export interface FormSnapshot {
  readonly id: string
  readonly title: string
  readonly fields: readonly FormField[]
}

export interface FormDraft {
  readonly document: DocumentSnapshot
  readonly preserved: PreservedFormFields
}

/**
 * Where every field of the snapshot goes.
 *
 * Adding a field to `FormSnapshot` without adding it here is a compile error, which is the whole
 * point: the default outcome of forgetting must be a failed build, not lost data on save.
 */
export const HYDRATE_COVERAGE: Record<keyof FormSnapshot, 'document' | 'preserved'> = {
  fields: 'document',
  id: 'preserved',
  // Editable, but not through the node tree — the title is a property of the form, not of any
  // field, and the document has no place for document-level props. See the note in `commit`.
  title: 'preserved',
}

const str = (props: Readonly<Record<string, unknown>>, key: string): string =>
  typeof props[key] === 'string' ? props[key] : ''

const num = (props: Readonly<Record<string, unknown>>, key: string, fallback: number): number =>
  typeof props[key] === 'number' ? props[key] : fallback

/**
 * Reassemble the closed union from the flattened props.
 *
 * Unknown or missing `answerKind` becomes `number`, the shape with no required structure. That is
 * a tolerant read of the document rather than a guess about intent: a field whose kind could not
 * be understood still has to render, and the domain constructor will refuse it on save if the
 * result is genuinely invalid.
 */
const answerFrom = (props: Readonly<Record<string, unknown>>): AnswerShape => {
  const kind = str(props, 'answerKind')
  if (kind === 'scale') {
    return { kind: 'scale', min: num(props, 'scaleMin', 1), max: num(props, 'scaleMax', 5) }
  }
  if (kind === 'choice') {
    const options = props['options']
    return {
      kind: 'choice',
      options: Array.isArray(options) ? options.filter((o): o is string => typeof o === 'string') : [],
    }
  }
  return { kind: 'number' }
}

const propsFrom = (answer: AnswerShape): Record<string, unknown> => {
  if (answer.kind === 'scale') {
    return { answerKind: 'scale', scaleMin: answer.min, scaleMax: answer.max, options: [] }
  }
  if (answer.kind === 'choice') {
    return { answerKind: 'choice', scaleMin: 1, scaleMax: 5, options: [...answer.options] }
  }
  return { answerKind: 'number', scaleMin: 1, scaleMax: 5, options: [] }
}

export const hydrate = (snapshot: FormSnapshot): FormDraft => {
  const document = emptyDocument(FORM_SCHEMA_ID, FORM_SCHEMA_VERSION)

  const nodes: Record<string, Node> = {}
  const childIds: Record<string, readonly NodeId[]> = {}
  const rootIds: NodeId[] = []

  // Sorted by `order` here so the DOCUMENT's sequence is the source of truth from this point on.
  // The editor reorders by moving ids in `rootIds`; an `order` prop as well would give one fact
  // two homes, and they would disagree the first time a drag updated one.
  for (const field of [...snapshot.fields].sort((a, b) => a.order - b.order)) {
    const nodeId = field.id as NodeId
    nodes[nodeId] = {
      id: nodeId,
      type: FIELD_NODE,
      props: {
        label: field.label,
        records: field.records,
        unit: field.unit,
        ...propsFrom(field.answer),
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

export const commit = (draft: FormDraft): FormSnapshot => ({
  ...draft.preserved,
  // `order` is derived from position in `rootIds`, which is why "orders are exactly 0..n-1" can
  // never be violated by the editor: the index IS the order.
  fields: draft.document.rootIds.map((nodeId, index) => {
    const props = draft.document.nodes[nodeId]?.props ?? {}
    return {
      id: nodeId,
      label: str(props, 'label'),
      records: str(props, 'records'),
      unit: str(props, 'unit'),
      answer: answerFrom(props),
      order: index,
    }
  }),
})

/**
 * Strip what a round trip is not required to preserve.
 *
 * Only `order` is normalised, because it is DERIVED on commit — a snapshot whose fields arrived
 * with orders 5, 9, 12 legitimately commits as 0, 1, 2. Everything else must survive exactly.
 */
export const normalize = (snapshot: FormSnapshot): FormSnapshot => ({
  ...snapshot,
  fields: [...snapshot.fields]
    .sort((a, b) => a.order - b.order)
    .map((field, index) => ({ ...field, order: index })),
})
