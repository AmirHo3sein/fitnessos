import { err, ok, type Result } from '@fitnessos/kernel'
import type { IndicatorKind } from './IndicatorKind'

/**
 * `CheckInForm` — the instrument by which a self-reported measurement is acquired.
 *
 * ## Why this lives in Measurement rather than a context of its own
 *
 * A form is not a new centre of the domain (ADR-0004 fixes those at six). It is the mechanism
 * behind `Acquisition.self-reported`: a coach authors the questions, the athlete answers them,
 * and each answer becomes an `Observation`. Putting it beside `Acquisition` keeps the instrument
 * and the provenance it produces in one place; a `Forms` context would own a thing whose only
 * purpose is to create records it does not own.
 *
 * It is also why Measurement has now graduated to its own package (handbook §2.1): a context
 * graduates when it acquires an editor, and this is that editor.
 *
 * ## The invariant that matters
 *
 * **Every field says what it records.** A field carries an `IndicatorKind` and a unit, so an
 * answer has somewhere to go. A form with a question that produces nothing is a survey, and this
 * product does not need a survey tool — it needs measurements. That constraint is what keeps the
 * builder from drifting into one.
 *
 * Order is DERIVED from position, exactly as it is in the Program Builder: the index in the list
 * is the order. Carrying it as a field as well would give one fact two homes.
 */

const brand = Symbol('CheckInForm')

/**
 * How the athlete answers. CLOSED, because the variants differ in required structure — a scale
 * needs bounds, a choice needs options, a number needs neither (ADR-0020's exception).
 */
export type AnswerShape =
  | { readonly kind: 'number' }
  | { readonly kind: 'scale'; readonly min: number; readonly max: number }
  | { readonly kind: 'choice'; readonly options: readonly string[] }

export interface FormField {
  readonly id: string
  /** The question, in the coach's words. */
  readonly label: string
  /** What the answer becomes. An open vocabulary (ADR-0020), same as everywhere in Measurement. */
  readonly records: IndicatorKind
  /** Invariant N11: an answer is never recorded without its unit. */
  readonly unit: string
  readonly answer: AnswerShape
  /** Zero-based. Contiguity is an invariant — see `checkInForm`. */
  readonly order: number
}

export interface CheckInForm {
  readonly [brand]: true
  readonly id: string
  readonly title: string
  readonly fields: readonly FormField[]
}

export type CheckInFormError =
  | { readonly kind: 'title-empty' }
  | { readonly kind: 'no-fields' }
  | { readonly kind: 'duplicate-field-id'; readonly id: string }
  | { readonly kind: 'label-empty'; readonly id: string }
  | { readonly kind: 'records-nothing'; readonly id: string }
  | { readonly kind: 'unit-missing'; readonly id: string }
  | { readonly kind: 'field-order-not-contiguous'; readonly orders: readonly number[] }
  | { readonly kind: 'scale-not-ascending'; readonly id: string }
  | { readonly kind: 'choice-has-no-options'; readonly id: string }
  | { readonly kind: 'duplicate-indicator'; readonly records: string }

export interface CheckInFormInput {
  readonly id: string
  readonly title: string
  readonly fields: readonly FormField[]
}

const answerError = (field: FormField): CheckInFormError | null => {
  if (field.answer.kind === 'scale' && field.answer.min >= field.answer.max) {
    // A scale from 5 to 5 has one answer, and one from 5 to 1 renders backwards. Both are typos
    // that produce a form the athlete cannot complete meaningfully.
    return { kind: 'scale-not-ascending', id: field.id }
  }
  if (field.answer.kind === 'choice' && field.answer.options.length === 0) {
    return { kind: 'choice-has-no-options', id: field.id }
  }
  return null
}

export const checkInForm = (input: CheckInFormInput): Result<CheckInForm, CheckInFormError> => {
  if (input.title.trim() === '') return err({ kind: 'title-empty' })

  if (input.fields.length === 0) {
    // A form with no questions asks nothing. It is the state a half-finished builder session
    // would save, and every consumer downstream would have to special-case it.
    return err({ kind: 'no-fields' })
  }

  const seenIds = new Set<string>()
  const seenIndicators = new Set<string>()
  for (const field of input.fields) {
    if (seenIds.has(field.id)) return err({ kind: 'duplicate-field-id', id: field.id })
    seenIds.add(field.id)

    if (field.label.trim() === '') return err({ kind: 'label-empty', id: field.id })
    if (field.records.trim() === '') return err({ kind: 'records-nothing', id: field.id })
    if (field.unit.trim() === '') return err({ kind: 'unit-missing', id: field.id })

    if (seenIndicators.has(field.records)) {
      /*
       * Two questions recording the same indicator on one form produce two observations of the
       * same thing at the same instant, and nothing downstream can say which is true. It is a
       * data-modelling mistake that looks like a harmless duplicate question in the builder.
       */
      return err({ kind: 'duplicate-indicator', records: field.records })
    }
    seenIndicators.add(field.records)

    const problem = answerError(field)
    if (problem !== null) return err(problem)
  }

  /*
   * Orders must be exactly 0..n-1, each once — the same invariant as `ProgramVersion`, and it
   * catches the same bug: a reorder that writes back `order` for only the moved field leaves a
   * gap or a duplicate. Neither throws; the form just renders in an order nobody chose.
   *
   * Deduplicated FIRST. Comparing `orders.length` to the expected size compares two counts that
   * are equal by construction, so `[0, 0]` sails through — the mistake made once already in
   * `ProgramVersion` and worth not repeating.
   */
  const orders = input.fields.map((f) => f.order)
  const distinct = new Set(orders)
  const expected = new Set(input.fields.map((_, index) => index))
  if (distinct.size !== input.fields.length || !orders.every((o) => expected.has(o))) {
    return err({ kind: 'field-order-not-contiguous', orders })
  }

  return ok({
    [brand]: true,
    id: input.id,
    title: input.title.trim(),
    // Sorted and frozen, so consumers get one canonical order and the immutability claim is true
    // at runtime rather than only in the types.
    fields: Object.freeze([...input.fields].sort((a, b) => a.order - b.order)),
  })
}
