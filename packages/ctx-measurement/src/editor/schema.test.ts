import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isOk } from '@fitnessos/kernel'
import { checkInForm } from '../domain/CheckInForm'
import type { AnswerShape, FormField } from '../domain/CheckInForm'
import { HYDRATE_COVERAGE, commit, hydrate, normalize, type FormSnapshot } from './schema'

/**
 * Non-blank text.
 *
 * `fc.string({ minLength: 1 })` was the first version and it generated `" "` — which the domain
 * correctly refuses, so the round-trip property was asserting something stronger than intended:
 * that commit produces a VALID form from any input, rather than that it does not introduce
 * invalidity. A document genuinely can hold a blank label, because a coach can clear the field
 * mid-edit; the constructor refusing it on save is the designed behaviour, not a defect.
 */
const arbText = fc.string({ minLength: 1 }).filter((s) => s.trim() !== '')

const arbAnswer: fc.Arbitrary<AnswerShape> = fc.oneof(
  fc.constant({ kind: 'number' } as const),
  fc
    .tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 6, max: 10 }))
    .map(([min, max]) => ({ kind: 'scale', min, max }) as const),
  fc
    .array(arbText, { minLength: 1, maxLength: 4 })
    .map((options) => ({ kind: 'choice', options }) as const),
)

const arbField = (index: number): fc.Arbitrary<FormField> =>
  fc.record({
    id: fc.constant(`f${String(index)}`),
    label: arbText,
    records: fc.constantFrom('bodyweight', 'sleep', 'soreness', 'mood'),
    unit: fc.constantFrom('kg', 'h', 'rating'),
    answer: arbAnswer,
    order: fc.constant(index),
  })

const arbForm: fc.Arbitrary<FormSnapshot> = fc
  .integer({ min: 1, max: 4 })
  .chain((count) =>
    fc.record({
      id: fc.constant('form-1'),
      title: arbText,
      fields: fc.tuple(...Array.from({ length: count }, (_, i) => arbField(i))),
    }),
  )

describe('the round trip', () => {
  it('commit(hydrate(x)) preserves the form', () => {
    /**
     * D-09's first mechanism. The failure it prevents is silent data loss on save: hydrate drops
     * a field, the coach edits something unrelated, commit writes the document back, and what
     * was dropped is gone — with the product having reported success.
     */
    fc.assert(
      fc.property(arbForm, (form) => {
        expect(normalize(commit(hydrate(form)))).toEqual(normalize(form))
      }),
      { numRuns: 200 },
    )
  })

  it('survives an edit in the middle of the round trip', () => {
    // The realistic path. A round trip that only holds for untouched documents proves nothing
    // about a builder, whose entire purpose is to touch them.
    fc.assert(
      fc.property(arbForm, arbText, (form, label) => {
        const draft = hydrate(form)
        const firstId = draft.document.rootIds[0]
        if (firstId === undefined) return

        const edited = {
          ...draft,
          document: {
            ...draft.document,
            nodes: {
              ...draft.document.nodes,
              [firstId]: {
                ...draft.document.nodes[firstId]!,
                props: { ...draft.document.nodes[firstId]!.props, label },
              },
            },
          },
        }

        expect(commit(edited).fields[0]?.label).toBe(label)
        expect(commit(edited).fields).toHaveLength(form.fields.length)
      }),
      { numRuns: 200 },
    )
  })

  it('derives contiguous orders whatever the input orders were', () => {
    // The index IS the order, so the invariant "orders are exactly 0..n-1" cannot be violated by
    // the editor — which is why the builder never writes an order and never has to renumber.
    const scattered: FormSnapshot = {
      id: 'form-1',
      title: 'Morning check-in',
      fields: [
        { id: 'a', label: 'Weight', records: 'bodyweight', unit: 'kg', answer: { kind: 'number' }, order: 9 },
        { id: 'b', label: 'Sleep', records: 'sleep', unit: 'h', answer: { kind: 'number' }, order: 4 },
      ],
    }

    const committed = commit(hydrate(scattered))
    expect(committed.fields.map((f) => f.order)).toEqual([0, 1])
    // Sorted by the ORIGINAL order, not by id — hydrate is what establishes the sequence.
    expect(committed.fields.map((f) => f.id)).toEqual(['b', 'a'])
  })
})

describe('the flattened answer shape', () => {
  it('reassembles every variant', () => {
    // The one place the Form Builder genuinely differs from the Program Builder. Each variant
    // has to survive being taken apart into props and put back together.
    fc.assert(
      fc.property(arbAnswer, (answer) => {
        const form: FormSnapshot = {
          id: 'form-1',
          title: 'T',
          fields: [{ id: 'a', label: 'L', records: 'bodyweight', unit: 'kg', answer, order: 0 }],
        }
        expect(commit(hydrate(form)).fields[0]?.answer).toEqual(answer)
      }),
      { numRuns: 200 },
    )
  })

  it('falls back to the shape with no required structure when the kind is unreadable', () => {
    // A tolerant read of the DOCUMENT, not a guess about intent: a field whose kind cannot be
    // understood still has to render, and the domain constructor refuses it on save if what
    // results is genuinely invalid.
    const draft = hydrate({
      id: 'form-1',
      title: 'T',
      fields: [{ id: 'a', label: 'L', records: 'bodyweight', unit: 'kg', answer: { kind: 'number' }, order: 0 }],
    })
    const corrupted = {
      ...draft,
      document: {
        ...draft.document,
        nodes: {
          ...draft.document.nodes,
          a: { ...draft.document.nodes['a' as never]!, props: { answerKind: 'nonsense' } },
        },
      },
    }
    expect(commit(corrupted).fields[0]?.answer).toEqual({ kind: 'number' })
  })
})

describe('coverage and the domain', () => {
  it('accounts for every field of the snapshot', () => {
    // The compile-time half of D-09. This assertion is nearly redundant with the type, and it is
    // here because the type only fails at build time for someone who runs a build.
    expect(Object.keys(HYDRATE_COVERAGE).sort()).toEqual(['fields', 'id', 'title'])
  })

  it('produces a form the domain constructor accepts', () => {
    /**
     * The end of the chain, and the assertion that makes the rest matter: a round trip that
     * preserved everything but produced something the aggregate refuses would still be a builder
     * whose saves fail.
     *
     * `records` is drawn from a set of four and forms have up to four fields, so the arbitrary
     * can produce a duplicate indicator — which the domain rightly refuses. Filtered rather than
     * narrowed, so the generator keeps exercising the case elsewhere.
     */
    fc.assert(
      fc.property(arbForm, (form) => {
        const committed = commit(hydrate(form))
        const kinds = new Set(committed.fields.map((f) => f.records))
        fc.pre(kinds.size === committed.fields.length)

        expect(isOk(checkInForm(committed))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})
