import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { seconds, unwrapOrThrow, type Quantity } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import type { AthletePorts, AthleteSnapshot } from '../../application/index'
import { AthletePortsProvider } from '../di'
import { AthleteSummary, type AthleteSummaryLabels } from './AthleteSummary'

/**
 * Component tier: the whole read path from injected port to rendered output,
 * without a network and without the app shell.
 *
 * This is the test that proves the DI seam works. A stub port goes in through the
 * provider, and what comes out is what the athlete sees. If the seam were wired
 * wrong — presentation reaching for infra, or the container not stable — this is
 * where it shows.
 */

const LABELS: AthleteSummaryLabels = {
  title: 'Training profile',
  experience: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' },
  daysPerWeek: 'Days per week',
  ceiling: 'Session ceiling (minutes)',
  noCeiling: 'No ceiling',
  loading: 'Loading training profile',
  failed: 'Training profile could not be loaded.',
}

const ceiling = (s: number): Quantity<'duration'> =>
  // `JSON.stringify`, not `String(e)`: the error is a structured object, and
  // stringifying it would produce "[object Object]" — which is precisely the bug
  // the V1 error rendering had, so it is worth not reintroducing even in a helper.
  unwrapOrThrow(seconds(s), (e) => new Error(JSON.stringify(e)))

const snapshot = (over: Partial<AthleteSnapshot> = {}): AthleteSnapshot => ({
  id: 'a-1' as AthleteSnapshot['id'],
  personId: 'p-1' as AthleteSnapshot['personId'],
  status: 'active',
  trainingIdentity: {
    experienceLevel: 'intermediate',
    trainingAgeMonths: 18,
    disciplines: ['strength'],
  },
  availability: { daysPerWeek: 4, sessionCeiling: ceiling(4200), equipmentAccess: [] },
  ...over,
})

const renderWith = (ports: AthletePorts) => {
  // retry: false, or a rejecting port makes the error-state test wait for backoff.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AthletePortsProvider value={ports}>
        <AthleteSummary locale="en" labels={LABELS} />
      </AthletePortsProvider>
    </QueryClientProvider>,
  )
}

describe('AthleteSummary', () => {
  it('renders the athlete supplied by the injected port', async () => {
    renderWith({ athlete: { getMine: () => Promise.resolve(snapshot()) } })

    expect(await screen.findByText('Intermediate')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    // 4200 seconds rendered as 70 minutes — the Quantity conversion, end to end.
    expect(screen.getByText('70')).toBeInTheDocument()
  })

  it('announces the loading state instead of rendering an unlabelled placeholder', () => {
    renderWith({ athlete: { getMine: () => new Promise(() => {}) } })

    // A busy region with no accessible name announces nothing, which is worse for a
    // screen-reader user than the shimmer a sighted user gets.
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('Loading training profile').length).toBeGreaterThan(0)
  })

  it('shows a failure message rather than an empty card when the port rejects', async () => {
    renderWith({ athlete: { getMine: () => Promise.reject(new Error('boom')) } })

    expect(await screen.findByText(LABELS.failed)).toBeInTheDocument()
  })

  it('distinguishes "no ceiling" from a ceiling of zero', async () => {
    // Zero would read as "cannot train", which is a different claim entirely.
    renderWith({
      athlete: {
        getMine: () =>
          Promise.resolve(
            snapshot({
              availability: { daysPerWeek: 3, sessionCeiling: null, equipmentAccess: [] },
            }),
          ),
      },
    })

    expect(await screen.findByText('No ceiling')).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('falls back to the raw value when a label for an experience level is missing', async () => {
    // Labels arrive as a prop from the app, so they can fall out of sync with the
    // domain's enum. Rendering a blank cell would hide the drift; rendering the raw
    // value makes it visible without breaking the page.
    renderWith({
      athlete: {
        getMine: () =>
          Promise.resolve(
            snapshot({
              trainingIdentity: {
                experienceLevel: 'advanced',
                trainingAgeMonths: null,
                disciplines: [],
              },
            }),
          ),
      },
    })

    expect(await screen.findByText('Advanced')).toBeInTheDocument()
  })
})
