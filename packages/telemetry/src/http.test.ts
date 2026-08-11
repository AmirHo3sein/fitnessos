import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpTelemetry, type Transport } from './http'
import type { TelemetryEvent } from './events'

const anEvent = (name = 'Error'): TelemetryEvent => ({
  kind: 'unknown-error',
  surface: 'boundary',
  name,
  route: '/programme',
})

const spyTransport = () => {
  const posts: string[] = []
  const beacons: string[] = []
  const transport: Transport = {
    post: (_url, body) => posts.push(body),
    beacon: (_url, body) => {
      beacons.push(body)
      return true
    },
  }
  return { transport, posts, beacons }
}

const eventsIn = (body: string): readonly TelemetryEvent[] =>
  (JSON.parse(body) as { events: TelemetryEvent[] }).events

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('batching', () => {
  it('does not send until the batch is full', () => {
    // One request per event would turn a render loop that throws into a request flood against an
    // already-struggling backend.
    const { transport, posts } = spyTransport()
    const sink = createHttpTelemetry({ url: '/t', batchSize: 3, transport })

    sink.report(anEvent())
    sink.report(anEvent())
    expect(posts).toEqual([])

    sink.report(anEvent())
    expect(posts).toHaveLength(1)
    expect(eventsIn(posts[0]!)).toHaveLength(3)
  })

  it('sends a partial batch after the timeout, so one event is not held forever', () => {
    const { transport, posts } = spyTransport()
    const sink = createHttpTelemetry({ url: '/t', batchSize: 5, flushAfterMs: 1_000, transport })

    sink.report(anEvent())
    expect(posts).toEqual([])

    vi.advanceTimersByTime(1_000)
    expect(posts).toHaveLength(1)
    expect(eventsIn(posts[0]!)).toHaveLength(1)
  })

  it('does not send the same event twice', () => {
    // The queue is cleared BEFORE the transport runs. If it were cleared after, a transport that
    // threw synchronously would leave the batch queued and re-send it — one failure becoming a
    // growing duplicate stream.
    const throwing: Transport = {
      post: () => {
        throw new Error('network')
      },
      beacon: () => false,
    }
    const sink = createHttpTelemetry({ url: '/t', batchSize: 1, transport: throwing })

    sink.report(anEvent('first'))
    sink.report(anEvent('second'))

    const observed = spyTransport()
    const recovered = createHttpTelemetry({ url: '/t', batchSize: 1, transport: observed.transport })
    recovered.report(anEvent('third'))
    expect(eventsIn(observed.posts[0]!).map((e) => 'name' in e && e.name)).toEqual(['third'])
  })
})

describe('the cap', () => {
  it('drops the OLDEST events past the ceiling', () => {
    /**
     * During an incident the newest events describe what is happening now; the hundredth copy of the
     * first error adds nothing. Dropping the newest instead would mean a queue that fills early and
     * then reports nothing about the rest of the outage.
     */
    const { transport, posts } = spyTransport()
    // Batch larger than the cap, so nothing is sent until the explicit flush and the cap is what
    // decides the contents.
    const sink = createHttpTelemetry({ url: '/t', batchSize: 100, maxQueued: 3, transport })

    for (const name of ['a', 'b', 'c', 'd', 'e']) sink.report(anEvent(name))
    sink.flush()

    const names = eventsIn(posts[0]!).map((e) => ('name' in e ? e.name : ''))
    expect(names).toEqual(['c', 'd', 'e'])
  })

  it('never grows without bound', () => {
    const { transport, posts } = spyTransport()
    const sink = createHttpTelemetry({ url: '/t', batchSize: 1_000, maxQueued: 10, transport })
    for (let i = 0; i < 500; i += 1) sink.report(anEvent(String(i)))
    sink.flush()
    expect(eventsIn(posts[0]!)).toHaveLength(10)
  })
})

describe('leaving the page', () => {
  it('uses a BEACON, not a fetch, when asked', () => {
    /**
     * A crash report that never leaves the device is not a report. `fetch` on `pagehide` is cancelled
     * by the navigation; a beacon is handed to the browser and survives it. The distinction is the
     * entire point of the unload path, which is why the transport is injected as two methods.
     */
    const { transport, posts, beacons } = spyTransport()
    const sink = createHttpTelemetry({ url: '/t', batchSize: 100, transport })

    sink.report(anEvent())
    sink.flush({ viaBeacon: true })

    expect(beacons).toHaveLength(1)
    expect(posts).toEqual([])
  })

  it('falls back to a post when the beacon is refused', () => {
    // `sendBeacon` returns false when the payload exceeds the browser's limit or the API is absent.
    // Losing the report in that case would be worse than a fetch that might be cancelled.
    const refusing: Transport = {
      post: (_url, body) => {
        posts.push(body)
      },
      beacon: () => false,
    }
    const posts: string[] = []
    const sink = createHttpTelemetry({ url: '/t', batchSize: 100, transport: refusing })

    sink.report(anEvent())
    sink.flush({ viaBeacon: true })
    expect(posts).toHaveLength(1)
  })

  it('flushing an empty queue sends nothing', () => {
    const { transport, posts, beacons } = spyTransport()
    const sink = createHttpTelemetry({ url: '/t', transport })
    sink.flush({ viaBeacon: true })
    expect([...posts, ...beacons]).toEqual([])
  })
})

describe('it cannot hurt the app it observes', () => {
  it('does not throw when the transport does', () => {
    // `guarded` enforces this for every sink rather than trusting each one. A vendor SDK that threw
    // synchronously would otherwise take out the error path — which is exactly when it runs.
    const exploding: Transport = {
      post: () => {
        throw new Error('boom')
      },
      beacon: () => {
        throw new Error('boom')
      },
    }
    const sink = createHttpTelemetry({ url: '/t', batchSize: 1, transport: exploding })

    expect(() => {
      sink.report(anEvent())
    }).not.toThrow()
    expect(() => {
      sink.flush({ viaBeacon: true })
    }).not.toThrow()
  })

  it('never retries a failed batch', () => {
    /*
     * Retrying telemetry during an outage is how a client amplifies one. A dropped batch is the
     * correct loss: the signal that telemetry is down is the absence of events, which is visible on
     * the receiving side.
     */
    let attempts = 0
    const failing: Transport = {
      post: () => {
        attempts += 1
        throw new Error('down')
      },
      beacon: () => false,
    }
    const sink = createHttpTelemetry({ url: '/t', batchSize: 1, transport: failing })

    sink.report(anEvent())
    vi.advanceTimersByTime(60_000)
    expect(attempts).toBe(1)
  })

  it('stop() cancels a pending flush', () => {
    const { transport, posts } = spyTransport()
    const sink = createHttpTelemetry({ url: '/t', batchSize: 10, flushAfterMs: 1_000, transport })
    sink.report(anEvent())
    sink.stop()
    vi.advanceTimersByTime(5_000)
    expect(posts).toEqual([])
  })
})
