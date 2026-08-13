import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionPorts, SyncIssueSnapshot } from '../../application/index'
import { ExecutionPortsProvider } from '../di'
import { SyncIssues } from './SyncIssues'

const LABELS = {
  conflictTitle: 'This session was already recorded',
  conflictBody: 'Another device recorded this session first.',
  rejectedTitle: 'A session could not be saved',
  rejectedBody: 'It is not saved anywhere.',
  mine: 'You logged',
  theirs: 'Recorded',
  summary: '{count} sets on {date}',
  unknownRecord: 'details unavailable',
  dismiss: 'Got it',
  loadFailed: 'We could not check whether any logs are still waiting to be sent.',
  retry: 'Try again',
}

const conflict = (over: Partial<SyncIssueSnapshot> = {}): SyncIssueSnapshot => ({
  id: 'i1',
  reason: 'conflict',
  mine: { performedOn: { year: 2026, month: 8, day: 10 }, setCount: 5 },
  theirs: { performedOn: { year: 2026, month: 8, day: 10 }, setCount: 3 },
  at: 0,
  ...over,
})

const mount = (
  issues: readonly SyncIssueSnapshot[] | Error,
  dismiss = vi.fn(() => Promise.resolve()),
) => {
  const ports = {
    execution: {
      upcomingSessions: vi.fn(),
      logSession: vi.fn(),
      pendingLogCount: vi.fn(),
      syncIssues: () =>
        issues instanceof Error ? Promise.reject(issues) : Promise.resolve(issues),
      dismissSyncIssue: dismiss,
    },
  } as unknown as ExecutionPorts

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ExecutionPortsProvider value={ports}>
        <SyncIssues locale="en" labels={LABELS} />
      </ExecutionPortsProvider>
    </QueryClientProvider>,
  )
  return dismiss
}

describe('nothing to report', () => {
  it('renders nothing at all when there are no issues', async () => {
    // Not an empty card. A permanent "all good" panel on the sessions screen is noise that
    // trains the athlete to stop reading the place where a real problem will appear.
    mount([])
    // Waited on rather than asserted immediately: the query resolves asynchronously, so an
    // instant assertion would pass even if the component rendered a card a tick later.
    await waitFor(() => {
      expect(screen.queryByText(LABELS.conflictTitle)).not.toBeInTheDocument()
    })
    expect(document.querySelector('section')).toBeNull()
  })
})

describe('a conflict', () => {
  it('shows BOTH records so the athlete can tell them apart', async () => {
    // The point of the whole feature. Only they know which is true — one of these describes sets
    // a person actually performed.
    mount([conflict()])

    expect(await screen.findByText(LABELS.conflictTitle)).toBeInTheDocument()
    expect(screen.getByText(/5 sets on/)).toBeInTheDocument()
    expect(screen.getByText(/3 sets on/)).toBeInTheDocument()
  })

  it('renders the date in the reader’s calendar without shifting it', async () => {
    // `new Date("2026-08-10")` is UTC midnight, which renders as the 9th west of Greenwich. A
    // session performed on Monday shown as Sunday, for some athletes and not others.
    mount([conflict()])
    // The 10th, not the 9th. Both rows carry the date, so this asserts on all of them — the
    // exact wording is `Intl`'s business and varies by locale; the day number is the assertion.
    expect(await screen.findAllByText(/August 10, 2026/)).toHaveLength(2)
  })

  it('still shows a row when the other record could not be read', async () => {
    // Omitting it would make the conflict look one-sided — as if there were nothing on the other
    // side — when the truth is that we could not read it.
    mount([conflict({ theirs: null })])

    expect(await screen.findByText(LABELS.conflictTitle)).toBeInTheDocument()
    expect(screen.getByText('details unavailable')).toBeInTheDocument()
  })
})

describe('a rejected log', () => {
  it('says it is not saved anywhere, and shows no second record', async () => {
    mount([conflict({ reason: 'rejected', theirs: null })])

    expect(await screen.findByText(LABELS.rejectedTitle)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.theirs)).not.toBeInTheDocument()
  })
})

describe('dismissal', () => {
  it('is the only thing that clears an issue', async () => {
    // Anything automatic would amount to deciding on the athlete's behalf that they had seen it.
    const dismiss = mount([conflict()])
    await screen.findByText(LABELS.conflictTitle)

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(dismiss).toHaveBeenCalledWith('i1')
  })

  it('lists every outstanding issue, not just the newest', async () => {
    mount([conflict({ id: 'i1' }), conflict({ id: 'i2', reason: 'rejected', theirs: null })])

    expect(await screen.findByText(LABELS.conflictTitle)).toBeInTheDocument()
    expect(screen.getByText(LABELS.rejectedTitle)).toBeInTheDocument()
  })
})

describe('a read that failed', () => {
  it('says so rather than rendering nothing', async () => {
    /*
     * The silence this banner exists to break, recreated by the banner.
     *
     * `data ?? []` made "could not read the issue log" identical to "nothing is waiting", and an
     * empty list renders null — so an athlete whose session was never sent saw exactly what an
     * athlete with nothing outstanding sees. The product said "saved" and then quietly did not say
     * otherwise.
     */
    mount(new Error('the store is unreadable'))

    expect(await screen.findByText(LABELS.loadFailed)).toBeInTheDocument()
    // Announced, not merely displayed. A screen-reader user has no other way to learn of it.
    expect(screen.getByRole('alert')).toHaveTextContent(LABELS.loadFailed)
  })
})
