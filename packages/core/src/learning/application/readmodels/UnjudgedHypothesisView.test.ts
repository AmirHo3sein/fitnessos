import type { DecisionOutcomeId, PlainDate, ProposalId } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import type { DecisionOutcomeSnapshot, ProposalSnapshot } from '../ports/index'
import { pendingProposals, unjudgedHypotheses } from './UnjudgedHypothesisView'

const on = (day: number, month = 10): PlainDate => ({ year: 2026, month, day })
const ASOF = on(20)

const proposal = (over: Partial<ProposalSnapshot> = {}): ProposalSnapshot => ({
    id: 'p1' as ProposalId,
    targetKind: 'program',
    targetId: 'prog-1',
    summary: 'Raise week three to 5% linear progression',
    rationale: 'Both blocks finished at the top of the range',
    hypothesis: {
      indicatorKind: 'estimated-1rm',
      claim: 'Back squat estimate rises by 5kg',
      horizon: on(10),
    },
    proposedOn: on(1, 9),
    decidedOn: on(2, 9),
    accepted: true,
    ...over,
})

const outcome = (over: Partial<DecisionOutcomeSnapshot> = {}): DecisionOutcomeSnapshot => ({
    id: 'o1' as DecisionOutcomeId,
    proposalId: 'p1' as ProposalId,
    verdict: 'held',
    rationale: 'The estimate rose by 7kg',
    decidedBy: 'coach-1',
    decidedOn: on(11),
    supersedes: null,
    ...over,
})

describe('what counts as an unanswered obligation', () => {
  it('lists an accepted proposal past its horizon with no verdict', () => {
    const views = unjudgedHypotheses([proposal()], [], ASOF)
    expect(views).toHaveLength(1)
    expect(views[0]).toMatchObject({ proposalId: 'p1', overdueByDays: 10 })
  })

  it('is zero days overdue on the day it becomes answerable', () => {
    // The boundary matters: a claim due today is due, not tomorrow.
    const views = unjudgedHypotheses([proposal()], [], on(10))
    expect(views[0]?.overdueByDays).toBe(0)
  })

  it('says nothing before the horizon', () => {
    // Silence before the horizon is not a missing verdict. Asking early would train a coach to
    // dismiss the list.
    expect(unjudgedHypotheses([proposal()], [], on(9))).toEqual([])
  })

  it('excludes a proposal that was rejected', () => {
    /**
     * A rejected proposal made no change, so there is nothing to have worked or not worked.
     * Asking a coach to judge the outcome of something that never happened is a question with
     * no answer, and a list full of them is a list nobody opens.
     */
    expect(unjudgedHypotheses([proposal({ accepted: false })], [], ASOF)).toEqual([])
  })

  it('excludes a proposal nobody has decided yet', () => {
    expect(
      unjudgedHypotheses([proposal({ accepted: null, decidedOn: null })], [], ASOF),
    ).toEqual([])
  })

  it('excludes one that already has a verdict', () => {
    expect(unjudgedHypotheses([proposal()], [outcome()], ASOF)).toEqual([])
  })
})

describe('corrections', () => {
  it('still counts as judged when the verdict was corrected', () => {
    /**
     * A correction is a NEW outcome pointing at the old one, and the port returns both. So
     * "is this judged" cannot be answered by counting — it is answered by whether any outcome
     * survives un-superseded. Counting would make a corrected proposal look doubly judged, and
     * a naive "latest wins" would break as soon as two corrections arrived out of order.
     */
    const first = outcome({ id: 'o1' as DecisionOutcomeId })
    const correction = outcome({
      id: 'o2' as DecisionOutcomeId,
      verdict: 'did-not-hold',
      supersedes: 'o1' as DecisionOutcomeId,
    })

    expect(unjudgedHypotheses([proposal()], [first, correction], ASOF)).toEqual([])
  })

  it('becomes unjudged again if the only verdict is superseded by nothing that survives', () => {
    // The degenerate case worth pinning: an outcome superseding one that is not present must not
    // make the proposal look unjudged — the surviving correction is still a verdict.
    const orphanCorrection = outcome({
      id: 'o2' as DecisionOutcomeId,
      supersedes: 'missing' as DecisionOutcomeId,
    })
    expect(unjudgedHypotheses([proposal()], [orphanCorrection], ASOF)).toEqual([])
  })
})

describe('ordering', () => {
  it('puts the longest overdue first', () => {
    // The oldest unanswered question is the one most likely to be forgotten, and the one whose
    // answer is least recoverable from memory.
    const recent = proposal({
      id: 'recent' as ProposalId,
      hypothesis: { indicatorKind: 'x', claim: 'c', horizon: on(19) },
    })
    const old = proposal({
      id: 'old' as ProposalId,
      hypothesis: { indicatorKind: 'x', claim: 'c', horizon: on(1) },
    })

    expect(unjudgedHypotheses([recent, old], [], ASOF).map((v) => v.proposalId)).toEqual([
      'old',
      'recent',
    ])
  })

  it('lists pending proposals oldest first', () => {
    // A proposal that has sat undecided longest is the one holding up the athlete.
    const a = proposal({ id: 'a' as ProposalId, accepted: null, decidedOn: null, proposedOn: on(5, 9) })
    const b = proposal({ id: 'b' as ProposalId, accepted: null, decidedOn: null, proposedOn: on(1, 9) })

    expect(pendingProposals([a, b]).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('excludes decided proposals from the pending list', () => {
    // Two different obligations at two different moments — "should we do this" and "did it
    // work". One list mixing them would ask a coach two unrelated questions in one column.
    expect(pendingProposals([proposal()])).toEqual([])
  })
})
