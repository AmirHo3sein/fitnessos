import { describe, expect, it, vi } from 'vitest'
import { toRouteTemplate } from './events'
import { guarded, noopTelemetry } from './port'

describe('toRouteTemplate', () => {
  it('replaces a UUID with :id', () => {
    expect(toRouteTemplate('/athletes/018f2c8a-0000-7000-8000-000000000001/onboarding')).toBe(
      '/athletes/:id/onboarding',
    )
  })

  it('replaces a long opaque id', () => {
    expect(toRouteTemplate('/goals/01JBQZ8XK9WMDF7T2N4R6VYAHC')).toBe('/goals/:id')
  })

  it('replaces something phone-shaped', () => {
    // The worst thing that could appear in a URL in this product.
    expect(toRouteTemplate('/people/+989123456789')).toBe('/people/:id')
    expect(toRouteTemplate('/people/989123456789')).toBe('/people/:id')
  })

  it('strips the query string, which is where ?next= and tokens live', () => {
    expect(toRouteTemplate('/sign-in?next=%2Fdashboard&code=123456')).toBe('/sign-in')
  })

  it('leaves ordinary segments alone', () => {
    expect(toRouteTemplate('/athletes/me/onboarding')).toBe('/athletes/me/onboarding')
  })

  it('over-matches rather than under-matches', () => {
    // A template slightly too coarse costs resolution. One that leaks an id costs a
    // privacy incident. This asserts the trade is made in the safe direction.
    expect(toRouteTemplate('/x/abcdefghijklmnopqrstuvwxyz')).toBe('/x/:id')
  })

  it('handles a root path', () => {
    expect(toRouteTemplate('/')).toBe('/')
  })
})

describe('guarded', () => {
  it('swallows a throwing sink', () => {
    // A vendor SDK that throws on a malformed config, or synchronously when ad-blocked,
    // must not take out the error path — which is exactly when it is running.
    const sink = guarded({
      report: () => {
        throw new Error('vendor exploded')
      },
    })
    expect(() => {
      sink.report({ kind: 'session-lost', rotationsAttempted: 1 })
    }).not.toThrow()
  })

  it('passes events through when the sink works', () => {
    const report = vi.fn()
    guarded({ report }).report({ kind: 'session-lost', rotationsAttempted: 2 })
    expect(report).toHaveBeenCalledWith({ kind: 'session-lost', rotationsAttempted: 2 })
  })

  it('does not log when swallowing', () => {
    // A sink failing on every event would otherwise fill the console with noise about the
    // thing meant to record noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    guarded({
      report: () => {
        throw new Error('boom')
      },
    }).report({ kind: 'session-lost', rotationsAttempted: 1 })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('noopTelemetry', () => {
  it('is silent and safe as a default', () => {
    expect(() => {
      noopTelemetry.report({ kind: 'session-lost', rotationsAttempted: 1 })
    }).not.toThrow()
  })
})
