import type { SubjectId } from '@fitnessos/kernel'
import { SubjectProvider } from '@fitnessos/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MeasurementPorts } from '../../application/index'
import { MeasurementPortsProvider } from '../di'
import { IndicatorList, type IndicatorLabels } from './IndicatorList'

/**
 * "Nothing measured yet" and "we could not read it" used to be the same picture.
 *
 * `useIndicators` did `data ?? []`, and this view renders the empty state for an empty array — so a
 * 401, a dropped request and a genuinely empty account all produced "nothing here yet", beside a
 * hint about logging a session. An athlete whose indicators merely failed to load was told, in
 * plain words, that their training has produced nothing.
 *
 * That is §4.9's failure class on the read side, and both branches are asserted here because a
 * test of one alone would pass against a view that always said the same thing.
 */

const LABELS: IndicatorLabels = {
  title: 'What your training has produced',
  none: 'Nothing measured yet',
  noneHint: 'Log a session and it will appear here.',
  loadFailed: 'We could not read your indicators just now.',
  retry: 'Try again',
  measuredOn: 'Measured',
  stale: 'not measured recently',
  notEnoughData: 'Not enough data to show a change yet',
  kinds: { bodyweight: 'Bodyweight', 'estimated-1rm': 'Estimated 1RM' },
}

const ASOF = { year: 2026, month: 8, day: 13 } as const

const mount = (indicators: () => Promise<unknown>) => {
  const ports = { measurement: { indicators } } as unknown as MeasurementPorts
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={client}>
      <SubjectProvider value={'athlete-1' as SubjectId}>
        <MeasurementPortsProvider value={ports}>
          <IndicatorList locale="en" labels={LABELS} asOf={ASOF} />
        </MeasurementPortsProvider>
      </SubjectProvider>
    </QueryClientProvider>,
  )
}

describe('a read that failed', () => {
  it('says so rather than claiming nothing has been measured', async () => {
    mount(() => Promise.reject(new Error('unauthenticated')))

    expect(await screen.findByText(LABELS.loadFailed)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.none)).not.toBeInTheDocument()
    expect(screen.queryByText(LABELS.noneHint)).not.toBeInTheDocument()
  })

  it('is announced, not merely displayed', async () => {
    // A bare `<div>` is what every one of these cards used to be. The message was on screen and
    // silent, which for a screen-reader user is the same as not being there.
    mount(() => Promise.reject(new Error('unauthenticated')))

    expect(await screen.findByRole('alert')).toHaveTextContent(LABELS.loadFailed)
  })

  it('offers a way back without a full reload', async () => {
    mount(() => Promise.reject(new Error('unauthenticated')))

    expect(await screen.findByRole('button', { name: LABELS.retry })).toBeInTheDocument()
  })
})

describe('a genuinely empty account', () => {
  it('still gets the empty state, and no failure', async () => {
    // The other half. Without this a view that reported failure unconditionally would pass above.
    mount(() => Promise.resolve([]))

    expect(await screen.findByText(LABELS.none)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.loadFailed)).not.toBeInTheDocument()
  })
})
