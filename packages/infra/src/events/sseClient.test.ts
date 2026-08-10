import { describe, expect, it, vi } from 'vitest'
import { openEventStream } from './sseClient'
import { INVALIDATIONS, isKnownKind, keysFor } from './invalidationMap'

/** A fake `EventSource` with the two handlers the client sets, and nothing else. */
class FakeSource {
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {}
  close() {
    this.closed = true
  }
  emit(kind: string, id = '1') {
    this.onmessage?.({ data: JSON.stringify({ kind }), lastEventId: id, type: 'message' } as MessageEvent<string>)
  }
  fail() {
    this.onerror?.()
  }
}

const harness = (overrides: Partial<Parameters<typeof openEventStream>[0]> = {}) => {
  const sources: FakeSource[] = []
  const events: { kind: string; id: string }[] = []
  const gaveUp = vi.fn()
  const authLost = vi.fn()

  const handle = openEventStream({
    url: '/api/v1/events',
    onEvent: (event) => events.push(event),
    onGaveUp: gaveUp,
    onSuspectedAuthLoss: authLost,
    create: (url) => {
      const source = new FakeSource(url)
      sources.push(source)
      return source as unknown as EventSource
    },
    ...overrides,
  })

  return { handle, sources, events, gaveUp, authLost, latest: () => sources[sources.length - 1]! }
}

describe('what the client does with a stream', () => {
  it('opens one connection, not two', () => {
    // Two streams means every event arrives twice, and the duplicate invalidation is invisible —
    // it just doubles the fetches.
    const { sources } = harness()
    expect(sources).toHaveLength(1)
  })

  it('reads the kind from the payload, not from the event name', () => {
    /**
     * `EventSource` routes a NAMED event to `addEventListener(name)` and never to `onmessage`. A
     * server that names its events therefore makes `onmessage` silent — so the kind travels in the
     * data as well, and the client does not need to know every kind in advance to hear it.
     */
    const { latest, events } = harness()
    latest().emit('programme-revised', '7')
    expect(events).toEqual([{ kind: 'programme-revised', id: '7' }])
  })

  it('does NOT reconnect by itself after a drop', () => {
    /**
     * The spike's central finding. `EventSource` already reconnects, with backoff, sending
     * `Last-Event-ID` unasked. A reconnect loop here would race the browser's and produce two
     * sockets — so the correct client is the one that does nothing, and this test is what stops
     * someone "fixing" that later.
     */
    const { sources, latest } = harness()
    latest().fail()
    expect(sources).toHaveLength(1)
    expect(sources[0]!.closed).toBe(false)
  })

  it('gives up after repeated failures rather than hammering a dead endpoint', () => {
    // A stream that has failed six times in a row is not a blip. Retrying forever from every open
    // tab is how a client contributes to an outage instead of surviving one.
    const { latest, gaveUp } = harness()
    for (let i = 0; i < 6; i += 1) latest().fail()
    expect(gaveUp).toHaveBeenCalledOnce()
    expect(latest().closed).toBe(true)
  })

  it('a successful event clears the failure count', () => {
    // Otherwise six drops spread over a working day would eventually silence a healthy stream.
    const { latest, gaveUp } = harness()
    for (let i = 0; i < 5; i += 1) latest().fail()
    latest().emit('session-logged')
    for (let i = 0; i < 5; i += 1) latest().fail()
    expect(gaveUp).not.toHaveBeenCalled()
  })

  it('reports a SUSPECTED auth loss on two immediate failures', () => {
    /*
     * `EventSource` exposes no status code, so a 401 is indistinguishable from a dropped socket. Two
     * failures in immediate succession is the closest available signal to a refusal. This is a
     * heuristic, it is the weakest part of the design, and the test says so out loud so nobody reads
     * it as a guarantee.
     */
    const { latest, authLost } = harness()
    latest().fail()
    latest().fail()
    expect(authLost).toHaveBeenCalled()
  })

  it('reopens on request, after the caller has refreshed', () => {
    const { handle, sources } = harness()
    handle.reopen()
    expect(sources).toHaveLength(2)
    expect(sources[0]!.closed).toBe(true)
  })

  it('stays closed after close, even if something calls back', () => {
    // A handle closed on unmount must not resurrect itself from a late error callback.
    const { handle, sources, latest } = harness()
    handle.close()
    latest().fail()
    expect(sources).toHaveLength(1)
  })
})

describe('the invalidation map', () => {
  it('maps a programme revision to the sessions the athlete is looking at', () => {
    // The case the mechanism exists for: an athlete on today's session while their coach changes it.
    expect(keysFor('programme-revised')).toContain('sessions')
  })

  it('IGNORES an unknown kind rather than refetching everything', () => {
    /**
     * A newer server will publish kinds this client has never heard of. The safe-looking choice —
     * invalidate the world — turns every unrecognised event into a thundering herd from every open
     * tab, which is worse than missing an update.
     */
    expect(isKnownKind('something-new')).toBe(false)
    expect(keysFor('something-new')).toEqual([])
  })

  it('never maps a kind to an empty list, which would be a silent no-op', () => {
    for (const [kind, keys] of Object.entries(INVALIDATIONS)) {
      expect(keys.length, kind).toBeGreaterThan(0)
    }
  })
})
