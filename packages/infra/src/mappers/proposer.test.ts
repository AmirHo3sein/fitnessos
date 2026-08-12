import { describe, expect, it } from 'vitest'
import { proposalFrom } from './learning'

const base = {
  id: '019ff600-0000-7000-8000-000000000001',
  targetKind: 'program',
  targetId: '019ff600-0000-7000-8000-000000000002',
  summary: 'Add a second squat day',
  rationale: 'Frequency has been the limiting factor',
  hypothesis: { indicatorKind: 'estimated-1rm', claim: 'it rises', horizon: '2026-12-01' },
  proposedOn: '2026-08-12',
}

describe('a proposal says who suggested it', () => {
  it('carries an assistant proposer', () => {
    const p = proposalFrom({ ...base, proposedBy: { kind: 'assistant' } })
    expect(p.proposedBy).toEqual({ kind: 'assistant' })
  })

  it('carries a named human proposer', () => {
    const personId = '019ff600-0000-7000-8000-00000000000a'
    const p = proposalFrom({ ...base, proposedBy: { kind: 'human', personId } })
    expect(p.proposedBy).toEqual({ kind: 'human', personId })
  })

  it('REFUSES an unnamed human rather than narrowing it to the assistant', () => {
    /*
     * The tolerant-reader instinct (ADR-0031) does not belong here. The two variants are different
     * claims about who spoke, and quietly turning an unnamed human into an assistant would attribute
     * a coach's suggestion to the machine — in the one record whose whole purpose is provenance.
     */
    expect(() => proposalFrom({ ...base, proposedBy: { kind: 'human' } })).toThrow()
  })
})
