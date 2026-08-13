import type { SubjectId } from '@fitnessos/kernel'
import { SubjectProvider } from '@fitnessos/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LearningPorts } from '../../application/index'
import { LearningPortsProvider } from '../di'
import { UnjudgedHypotheses, type UnjudgedLabels } from './UnjudgedHypotheses'

/**
 * Two correct decisions that combined into the failure this screen exists to prevent.
 *
 * Rendering nothing when nothing is owed is deliberate: a permanent "all caught up" panel is noise,
 * and noise teaches people to stop reading the place a real obligation will appear. And `?? []` on
 * a failed query is the ordinary defensive shape.
 *
 * Together they meant a failed read produced an empty list, an empty list rendered nothing, and a
 * coach with three overdue verdicts saw the same blank space as a coach with none — which is
 * exactly the "accepts every suggestion and never looks back" product ADR-0003 is meant to rule
 * out, arriving through the screen built to rule it out.
 */

const LABELS: UnjudgedLabels = {
  title: 'Waiting for a verdict',
  intro: 'Each of these was accepted on a claim that has now come due.',
  claim: 'Claim',
  dueOn: 'Due',
  overdue: 'overdue',
  held: 'It held',
  didNotHold: 'It did not hold',
  rationaleLabel: 'Why',
  rationalePlaceholder: 'What actually happened?',
  submit: 'Record this',
  rationaleRequired: 'A verdict needs a reason.',
  loadFailed: 'We could not check whether anything is waiting for a verdict.',
  retry: 'Try again',
}

const ASOF = { year: 2026, month: 8, day: 13 } as const

const mount = (
  proposals: () => Promise<unknown>,
  outcomes: () => Promise<unknown> = () => Promise.resolve([]),
) => {
  const ports = {
    learning: { proposals, outcomes, renderVerdict: vi.fn() },
  } as unknown as LearningPorts
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <SubjectProvider value={'athlete-1' as SubjectId}>
        <LearningPortsProvider value={ports}>
          <UnjudgedHypotheses locale="en" labels={LABELS} asOf={ASOF} />
        </LearningPortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )
}

describe('a read that failed', () => {
  it('says so rather than rendering nothing', async () => {
    mount(() => Promise.reject(new Error('unauthenticated')))

    expect(await screen.findByText(LABELS.loadFailed)).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(LABELS.loadFailed)
  })

  it('reports a failed OUTCOMES read too, not only proposals', async () => {
    /*
     * The half a single-query test would miss, and the more dangerous one: with outcomes missing,
     * every accepted proposal looks unjudged. The list would be wrong rather than empty — and
     * `?? []` on both meant neither failure said anything at all.
     */
    mount(
      () => Promise.resolve([]),
      () => Promise.reject(new Error('unauthenticated')),
    )

    expect(await screen.findByText(LABELS.loadFailed)).toBeInTheDocument()
  })
})

describe('nothing owed', () => {
  it('still renders nothing', async () => {
    // The other half, and the behaviour that must survive the fix: silence is the right answer
    // when there is genuinely nothing to answer for.
    mount(() => Promise.resolve([]))

    await waitFor(() => {
      expect(screen.queryByText(LABELS.loadFailed)).not.toBeInTheDocument()
    })
    expect(screen.queryByText(LABELS.title)).not.toBeInTheDocument()
  })
})
