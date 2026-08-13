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
  emit(kind: string, id = '1', subject?: string) {
    // `subject` omitted by default, because a frame without one is legitimate — an older server — and
    // the client must still deliver the event rather than discarding it.
    this.onmessage?.({
      data: JSON.stringify(subject === undefined ? { kind } : { kind, subject }),
      lastEventId: id,
      type: 'message',
    } as MessageEvent<string>)
  }
  fail() {
    this.onerror?.()
  }
}

/** A controllable visibility source, since these tests run with no document. */
const fakeVisibility = () => {
  let hidden = false
  const listeners = new Set<() => void>()
  return {
    port: {
      isHidden: () => hidden,
      onChange: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    set: (next: boolean) => {
      hidden = next
      for (const listener of listeners) listener()
    },
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
    expect(events).toEqual([{ kind: 'programme-revised', subject: null, id: '7' }])
  })

  it('carries the subject a frame names, and null when it names none', () => {
    /**
     * §5.6. The subject is ADDRESSING rather than entity state: it says whose cache to invalidate and
     * carries no value that could disagree with what the cache holds.
     *
     * `null` is a real answer, not a parse failure — a frame from an older server has no subject, and
     * the consumer falls back to its own. Discarding such an event instead would make every screen
     * stop updating the moment a server was rolled back.
     */
    const { latest, events } = harness()
    latest().emit('session-logged', '1', '019ff600-0000-7000-8000-00000000000a')
    latest().emit('session-logged', '2')

    expect(events).toEqual([
      { kind: 'session-logged', subject: '019ff600-0000-7000-8000-00000000000a', id: '1' },
      { kind: 'session-logged', subject: null, id: '2' },
    ])
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
    expect(keysFor('programme-revised')).toContain('session')
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

describe('pausing while the tab is hidden', () => {
  /**
   * Six connections per origin on HTTP/1.1, measured in the spike, and a stream holds one for its
   * whole life. Four open tabs consume four of them, and the tab someone is actually looking at
   * queues its requests behind three nobody is.
   */
  it('opens nothing while hidden', () => {
    const visibility = fakeVisibility()
    visibility.set(true)
    const { sources } = harness({ visibility: visibility.port })
    expect(sources).toHaveLength(0)
  })

  it('closes the socket when the tab is hidden', () => {
    const visibility = fakeVisibility()
    const { sources } = harness({ visibility: visibility.port })
    expect(sources).toHaveLength(1)

    visibility.set(true)
    expect(sources[0]!.closed).toBe(true)
  })

  it('reopens when the tab is shown again', () => {
    const visibility = fakeVisibility()
    const { sources } = harness({ visibility: visibility.port })
    visibility.set(true)
    visibility.set(false)
    expect(sources).toHaveLength(2)
    expect(sources[1]!.closed).toBe(false)
  })

  it('does not open a SECOND stream on a spurious visible event', () => {
    // `visibilitychange` can fire without the state actually changing. Two streams means every event
    // arrives twice, and the duplicate is invisible because it only doubles fetches.
    const visibility = fakeVisibility()
    const { sources } = harness({ visibility: visibility.port })
    visibility.set(false)
    visibility.set(false)
    expect(sources).toHaveLength(1)
  })

  it('an explicit close WINS over a later tab switch', () => {
    /**
     * The listener outlives nothing: a handle torn down on unmount must not be resurrected when
     * someone switches back to the tab. Without the `closed` guard the stream reopens with no owner,
     * and its invalidations land on a query client that has been discarded.
     */
    const visibility = fakeVisibility()
    const { handle, sources } = harness({ visibility: visibility.port })
    handle.close()
    visibility.set(true)
    visibility.set(false)
    expect(sources).toHaveLength(1)
  })
})

describe('carrying the resume position across a reopen', () => {
  it('a fresh stream asks to resume from the last id it saw', () => {
    /**
     * The platform sends `Last-Event-ID` only on `EventSource`'s OWN automatic reconnect. A newly
     * constructed one sends nothing and offers no API to set the header — so without this, every
     * deliberate reopen arrives with no position and a replaying server delivers the entire backlog
     * again, every event of it invalidating queries.
     */
    const visibility = fakeVisibility()
    const { sources, latest } = harness({ visibility: visibility.port })
    latest().emit('session-logged', '42')

    visibility.set(true)
    visibility.set(false)

    expect(sources[1]!.url).toBe('/api/v1/events?last-event-id=42')
  })

  it('asks for nothing when it has seen nothing', () => {
    // A first open must not send `last-event-id=` empty or 0 — one is malformed and the other is a
    // real position on a server that numbers from zero.
    const visibility = fakeVisibility()
    const { sources } = harness({ visibility: visibility.port })
    visibility.set(true)
    visibility.set(false)
    expect(sources[1]!.url).toBe('/api/v1/events')
  })

  it('keeps the position across an auth-triggered reopen too', () => {
    const { handle, sources, latest } = harness()
    latest().emit('session-logged', '7')
    handle.reopen()
    expect(sources[1]!.url).toBe('/api/v1/events?last-event-id=7')
  })

  it('advances the position as events arrive', () => {
    const { handle, sources, latest } = harness()
    latest().emit('session-logged', '7')
    latest().emit('observation-recorded', '9')
    handle.reopen()
    expect(sources[1]!.url).toContain('last-event-id=9')
  })

  it('forgets the position when a frame carries an empty id', () => {
    /*
     * The platform's own rule, and the two have to agree. `EventSource` keeps a last-event-ID buffer
     * that an empty `id:` sets to the empty string, and an empty buffer suppresses the
     * `Last-Event-ID` header on the next reconnect.
     *
     * Ignoring an empty id made them disagree: the browser sent no header while this still appended
     * `?last-event-id=` to the URL, so the server saw the very position the frame had told the client
     * to forget. The server sends an empty id on `resume-impossible` — the one frame whose whole
     * meaning is "the position you hold cannot be honoured".
     */
    const { handle, sources, latest } = harness()
    latest().emit('session-logged', '9')
    latest().emit('resume-impossible', '')
    handle.reopen()
    expect(sources[1]!.url).toBe('/api/v1/events')
  })
})
