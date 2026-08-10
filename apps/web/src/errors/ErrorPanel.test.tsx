import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TelemetryEvent, TelemetryPort } from '@fitnessos/telemetry'
import { ErrorPanel } from './ErrorPanel'
import { errorLabelsFor } from './labels'

const LABELS = {
  title: 'Something went wrong',
  body: 'This part of the app could not be shown.',
  retry: 'Try again',
  home: 'Back to the start',
  reference: 'Reference:',
}

const mount = (error: Error & { digest?: string }, route = '/programme') => {
  const events: TelemetryEvent[] = []
  const telemetry: TelemetryPort = {
    report: (event) => {
      events.push(event)
    },
  }
  const reset = vi.fn()

  render(
    <ErrorPanel
      error={error}
      reset={reset}
      labels={LABELS}
      telemetry={telemetry}
      route={route}
    />,
  )
  return { events, reset }
}

describe('what the user is told', () => {
  it('explains, and offers both a retry and a way out', () => {
    mount(new Error('boom'))

    expect(screen.getByText(LABELS.title)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: LABELS.retry })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: LABELS.home })).toBeInTheDocument()
  })

  it('NEVER shows the error message', () => {
    /**
     * The load-bearing assertion. `error.message` may contain user data — this codebase's own
     * telemetry vocabulary refuses validator messages for exactly this reason, because Zod's
     * `invalid_enum_value` renders the received value verbatim. A phone number on screen is a
     * phone number in the screenshot attached to a support ticket.
     */
    mount(new Error('no athlete for +989123456789'))

    expect(screen.queryByText(/989123456789/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no athlete for/)).not.toBeInTheDocument()
  })

  it('shows the digest, which identifies the failure without describing it', () => {
    // Exactly what someone contacting support needs, and exactly what an attacker cannot use.
    const error = Object.assign(new Error('boom'), { digest: 'a1b2c3d4' })
    mount(error)

    expect(screen.getByText(/a1b2c3d4/)).toBeInTheDocument()
  })

  it('omits the reference line entirely when there is no digest', () => {
    // A client-side throw has none. "Reference:" followed by nothing reads as a broken page
    // inside the page that exists to explain a broken page.
    mount(new Error('boom'))
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument()
  })

  it('retries in place rather than reloading', async () => {
    // `reset()` re-renders the failed segment. A transient failure — a race on first paint, a
    // chunk that did not load — recovers without losing the rest of the page.
    const { reset } = mount(new Error('boom'))

    await userEvent.click(screen.getByRole('button', { name: LABELS.retry }))
    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('what is reported', () => {
  it('reports the constructor name only', () => {
    class ContractViolationError extends Error {
      override readonly name = 'ContractViolationError'
    }
    const { events } = mount(new ContractViolationError('Athlete.status: invalid_enum_value'))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'unknown-error',
      surface: 'boundary',
      name: 'ContractViolationError',
    })
    // The message is not in the event either, by any key.
    expect(JSON.stringify(events[0])).not.toContain('invalid_enum_value')
  })

  it('reduces the route to a template, so no id leaves the device', () => {
    // An id in a route both destroys aggregation in the dashboard and ships an identifier for
    // every crash.
    const { events } = mount(
      new Error('boom'),
      '/programme/018f2c8a-0003-7000-8000-000000000001',
    )

    expect(events[0]).toMatchObject({ route: '/programme/:id' })
  })

  it('reports once, not once per render', async () => {
    // A boundary that re-reported on every re-render would inflate the count of a crash that
    // happened once, which is the number an alert threshold is set against.
    const { events } = mount(new Error('boom'))

    await userEvent.click(screen.getByRole('button', { name: LABELS.retry }))
    expect(events).toHaveLength(1)
  })
})

describe('which language the boundary speaks', () => {
  it('defaults to Persian, because unprefixed IS Persian', () => {
    // Correct twice over: it is the product's primary language, and an unprefixed path means
    // Persian by the routing config. A boundary that defaulted to English would switch language
    // on people at the worst moment.
    expect(errorLabelsFor('/programme').title).toBe('مشکلی پیش آمد')
    expect(errorLabelsFor('/').title).toBe('مشکلی پیش آمد')
  })

  it('uses English under the /en prefix', () => {
    expect(errorLabelsFor('/en/programme').title).toBe('Something went wrong')
    expect(errorLabelsFor('/en').title).toBe('Something went wrong')
  })

  it('does not mistake a path that merely starts with those letters', () => {
    // `/enrolment` is not English. Matching on a bare prefix rather than a segment is the classic
    // way a locale check quietly misfires on one route.
    expect(errorLabelsFor('/enrolment').title).toBe('مشکلی پیش آمد')
  })
})
