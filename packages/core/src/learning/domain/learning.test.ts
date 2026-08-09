import {
  isErr,
  isOk,
  type DecisionOutcomeId,
  type PlainDate,
  type ProposalId,
} from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { correct, decisionOutcome, type DecisionOutcomeInput } from './DecisionOutcome'
import { MAX_HORIZON_DAYS, hypothesis, isDue } from './Hypothesis'
import { proposal, type ProposalInput } from './Proposal'

const on = (day: number, month = 8): PlainDate => ({ year: 2026, month, day })
const PROPOSED_ON = on(10)

const validHypothesis = (over: Partial<Parameters<typeof hypothesis>[0]> = {}) =>
  hypothesis({
    indicatorKind: 'estimated-1rm',
    claim: 'Back squat estimate rises by 5kg',
    horizon: on(10, 10),
    proposedOn: PROPOSED_ON,
    ...over,
  })

const someHypothesis = () => {
  const result = validHypothesis()
  if (!isOk(result)) throw new Error('fixture is invalid')
  return result.value
}

const proposalInput = (over: Partial<ProposalInput> = {}): ProposalInput => ({
  id: 'p1' as ProposalId,
  targetKind: 'program',
  targetId: 'prog-1',
  summary: 'Raise week three to 5% linear progression',
  rationale: 'The last two blocks were completed at the top of the prescribed range',
  hypothesis: someHypothesis(),
  proposedOn: PROPOSED_ON,
  ...over,
})

const outcomeInput = (over: Partial<DecisionOutcomeInput> = {}): DecisionOutcomeInput => ({
  id: 'o1' as DecisionOutcomeId,
  proposalId: 'p1' as ProposalId,
  verdict: 'held',
  rationale: 'The estimate rose by 7kg over the block',
  decidedBy: 'coach-1',
  decidedOn: on(10, 10),
  ...over,
})

describe('Hypothesis — the obligation to find out', () => {
  it('requires a falsifiable claim and something to measure it in', () => {
    // Without these, ADR-0003's "records why" degrades into recording THAT a human decided,
    // which is an audit trail of clicks.
    expect(isErr(validHypothesis({ claim: '  ' }))).toBe(true)
    expect(isErr(validHypothesis({ indicatorKind: '' }))).toBe(true)
  })

  it('refuses a horizon that is already due', () => {
    // It would arrive in the unjudged view at the moment of proposing, before the change it
    // predicts has had any chance to have an effect.
    expect(isErr(validHypothesis({ horizon: PROPOSED_ON }))).toBe(true)
    expect(isErr(validHypothesis({ horizon: on(9) }))).toBe(true)
  })

  it('refuses a horizon beyond a year', () => {
    // An obligation nobody will live to see discharged is an obligation in name only, and it
    // clutters the view that exists to show real ones.
    expect(isErr(validHypothesis({ horizon: { year: 2028, month: 1, day: 1 } }))).toBe(true)
    expect(MAX_HORIZON_DAYS).toBe(365)
  })

  it('accepts an indicator kind this build has never heard of', () => {
    // Indicator kinds are an open vocabulary (ADR-0020). Learning must not be the context that
    // has to ship before a new one can be predicted.
    expect(isOk(validHypothesis({ indicatorKind: 'grip-strength' }))).toBe(true)
  })

  it('answers due-ness as a query, against the date it is given', () => {
    // ADR-0006. There is no `isDue` field, and the assertion below that it stays absent is the
    // one that would fail if someone added a convenient one.
    const subject = someHypothesis()
    expect(isDue(subject, on(9, 10))).toBe(false)
    expect(isDue(subject, on(10, 10))).toBe(true)
    expect(subject).not.toHaveProperty('isDue')
  })
})

describe('Proposal — the before', () => {
  it('requires a stated reason', () => {
    // The exact failure ADR-0003 exists to prevent: a suggestion that carries authority while
    // being unreviewable.
    expect(isErr(proposal(proposalInput({ rationale: '   ' })))).toBe(true)
  })

  it('requires a summary and a target', () => {
    expect(isErr(proposal(proposalInput({ summary: '' })))).toBe(true)
    expect(isErr(proposal(proposalInput({ targetId: '  ' })))).toBe(true)
  })

  it('holds no model from another context', () => {
    /**
     * ADR-0019, asserted as a shape. A `blocks` or `programVersion` field here would put
     * Prescription's model inside Learning, and the first schema change over there would break
     * this context for no reason of its own.
     */
    const result = proposal(proposalInput())
    const value = isOk(result) ? (result.value as unknown as Record<string, unknown>) : {}

    for (const forbidden of ['blocks', 'programVersion', 'sets', 'goal', 'observation']) {
      expect(value).not.toHaveProperty(forbidden)
    }
  })

  it('has no accept, because accepting is not its to record', () => {
    // ADR-0010: the moment of change belongs to the changing context. Accepting produces a new
    // ProgramVersion whose authoringDecision records who decided and that an assistant proposed.
    const module = { proposal } as Record<string, unknown>
    expect(module).not.toHaveProperty('accept')
    expect(module).not.toHaveProperty('reject')
  })
})

describe('DecisionOutcome — the after', () => {
  it('requires a reason and a human decider', () => {
    // "It worked" with no reason is a rating, not a verdict. ADR-0003 asks for the why so a
    // later reader can disagree with the reasoning rather than the score.
    expect(isErr(decisionOutcome(outcomeInput({ rationale: ' ' })))).toBe(true)
    expect(isErr(decisionOutcome(outcomeInput({ decidedBy: '' })))).toBe(true)
  })

  it('is a first verdict when it supersedes nothing', () => {
    const result = decisionOutcome(outcomeInput())
    expect(isOk(result) && result.value.supersedes).toBeNull()
  })

  it('refuses to supersede itself', () => {
    expect(
      isErr(decisionOutcome(outcomeInput({ supersedes: 'o1' as DecisionOutcomeId }))),
    ).toBe(true)
  })
})

describe('corrections supersede rather than overwrite', () => {
  const first = () => {
    const result = decisionOutcome(outcomeInput())
    if (!isOk(result)) throw new Error('fixture is invalid')
    return result.value
  }

  it('produces a new outcome pointing at the one it replaces', () => {
    const original = first()
    const corrected = correct(original, {
      id: 'o2' as DecisionOutcomeId,
      verdict: 'did-not-hold',
      rationale: 'Re-read the series; the rise was within normal week-to-week variation',
      decidedBy: 'coach-2',
      decidedOn: on(20, 10),
    })

    expect(isOk(corrected) && corrected.value.supersedes).toBe('o1')
    expect(isOk(corrected) && corrected.value.verdict).toBe('did-not-hold')
    expect(isOk(corrected) && corrected.value.proposalId).toBe('p1')
  })

  it('leaves the original untouched', () => {
    /**
     * ADR-0007: immutable from creation. A verdict is evidence, and editing one in place would
     * rewrite what was concluded at the time — the only thing that makes a later disagreement
     * legible.
     */
    const original = first()
    correct(original, {
      id: 'o2' as DecisionOutcomeId,
      verdict: 'did-not-hold',
      rationale: 'x',
      decidedBy: 'coach-2',
      decidedOn: on(20, 10),
    })

    expect(original.verdict).toBe('held')
    expect(original.supersedes).toBeNull()
  })

  it('requires a decider rather than inheriting the previous one', () => {
    // A correction is a new judgement by a person. Carrying the old decider forward would
    // attribute this conclusion to whoever reached the last one.
    const corrected = correct(first(), {
      id: 'o2' as DecisionOutcomeId,
      verdict: 'held',
      rationale: 'x',
      decidedBy: '  ',
      decidedOn: on(20, 10),
    })
    expect(isErr(corrected)).toBe(true)
  })
})
