import { beforeAll, describe, expect, it } from 'vitest'
import { baseUrl, currentCookie, newId, origin, request, signIn } from './client'

/**
 * The five requirements that fail SILENTLY — no error on either side, just a client that quietly
 * stops working. These are the ones worth running first, because they are the ones nobody will
 * notice in staging.
 *
 * Each check names its section in `BACKEND-CONTRACT.md`. A failure here is a line in that document,
 * not a puzzle.
 */

beforeAll(async () => {
  await signIn()
})

describe('§5.1 · SSE frames must carry `id:` and `data:` only, never `event:`', () => {
  it('does not name its events', async () => {
    /**
     * A frame carrying `event: foo` is delivered by the browser to `addEventListener('foo')` and
     * NEVER to `onmessage`. A client with one handler goes deaf, with no error anywhere — and an
     * unknown kind becomes invisible rather than ignored, so the client cannot even count what it
     * failed to understand.
     */
    const frames = await readStream(1_500)
    expect(frames, 'the stream produced no frames at all — check §5.2 first').not.toBe('')

    const named = frames
      .split('\n')
      .filter((line) => line.startsWith('event:'))
    expect(named, 'frames must not use `event:`; put the kind in the data payload').toEqual([])
  })

  it('puts a `kind` in the data payload instead', async () => {
    const frames = await readStream(1_500)
    const dataLines = frames.split('\n').filter((line) => line.startsWith('data:'))
    expect(dataLines.length, 'no `data:` lines in the stream').toBeGreaterThan(0)

    for (const line of dataLines) {
      const payload: unknown = JSON.parse(line.slice('data:'.length).trim())
      expect(
        typeof payload === 'object' && payload !== null && 'kind' in payload,
        `every frame's data needs a "kind": got ${line}`,
      ).toBe(true)
    }
  })
})

describe('§5.2 · a prelude byte on connect', () => {
  it('sends something immediately, before any event exists', async () => {
    /**
     * Response headers are not flushed to a browser through a proxy until the first byte of BODY
     * arrives. Without a prelude, `EventSource` sits in CONNECTING indefinitely — no `open`, no
     * error — while `curl` against the origin server works perfectly. That asymmetry is how this
     * hides.
     *
     * A comment line (`: open`) is the conventional answer and costs nothing.
     */
    const frames = await readStream(1_200, { emit: false })
    expect(
      frames.length,
      'nothing arrived within 1.2s on a fresh stream: send a `: comment` immediately on connect',
    ).toBeGreaterThan(0)
  })

  it('asks intermediaries not to buffer', async () => {
    const response = await fetch(`${baseUrl()}/events`, {
      headers: { accept: 'text/event-stream', ...currentCookie() },
    })
    // Read nothing; the headers are the assertion.
    await response.body?.cancel()

    /*
     * The status FIRST, and this was a real defect.
     *
     * Pointed at a backend that had not implemented `/events` yet, this check reached straight for
     * `content-type`, got null, and reported "the given combination of arguments (null and string) is
     * invalid for this assertion" — a vitest internal error where the useful answer was "the endpoint
     * is not there". A conformance failure has to name the requirement, not the matcher.
     */
    expect(
      response.status,
      `the stream must answer 200 for an authenticated request; got ${String(response.status)}`,
    ).toBe(200)

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(
      response.headers.get('cache-control') ?? '',
      'send `Cache-Control: no-cache, no-transform`',
    ).toContain('no-cache')
    expect(
      response.headers.get('x-accel-buffering'),
      'send `X-Accel-Buffering: no` so a reverse proxy does not buffer the stream',
    ).toBe('no')
  })
})

describe('§5.3 · the resume position, from the header AND the query string', () => {
  it('replays only what follows a `Last-Event-ID` header', async () => {
    await emitEvent()
    await emitEvent()
    const all = idsIn(await readStream(1_200))
    expect(all.length, 'expected at least two events to exist by now').toBeGreaterThan(1)

    const from = all[0]!
    const resumed = idsIn(await readStream(1_200, { lastEventId: from, header: true }))
    expect(resumed, `resuming from ${from} must not replay ${from} itself`).not.toContain(from)
  })

  it('replays only what follows a `?last-event-id=` PARAMETER', async () => {
    /**
     * Not a convenience. The browser sends the header only on `EventSource`'s OWN automatic
     * reconnect; any reopen the client initiates — which this client does every time a tab becomes
     * visible again — constructs a new `EventSource` that sends no header and offers no API to set
     * one.
     *
     * Ignore the parameter and every tab switch replays the entire backlog, each event invalidating
     * queries.
     */
    await emitEvent()
    const all = idsIn(await readStream(1_200))

    /*
     * Asserted before it is used, and this check FALSELY PASSED without it.
     *
     * Against a backend with no `/events` yet, `all` was empty, `from` was `undefined`, and
     * `expect([]).not.toContain(undefined)` passed — reporting conformance for a requirement that was
     * never exercised. The sibling header-based check happened to assert a length and failed
     * correctly; this one did not, and a green tick on an unasked question is the worst output a
     * conformance suite can produce.
     */
    expect(
      all.length,
      'no events on the stream, so resume-by-parameter could not be exercised — check §5.1 and §5.2',
    ).toBeGreaterThan(0)

    const from = all[0]!
    const resumed = idsIn(await readStream(1_200, { lastEventId: from, header: false }))
    expect(
      resumed,
      `resuming from ?last-event-id=${from} must not replay ${from} itself`,
    ).not.toContain(from)
  })
})

describe('§5.4 · an unauthenticated stream is refused promptly', () => {
  it('answers 401 rather than holding the connection open', async () => {
    /**
     * `EventSource` cannot see a status code and retries every failure forever, so an accepted-but-
     * silent stream becomes an infinite reconnect loop from every open tab with nothing on screen.
     * The client detects this by inference, which only works if refusal is prompt and consistent.
     */
    const response = await fetch(`${baseUrl()}/events`, {
      headers: { accept: 'text/event-stream' },
    })
    await response.body?.cancel()
    expect(response.status, 'a stream with no session must be refused, not accepted').toBe(401)
  })
})

describe('§4.9 · a failed read must be distinguishable from "nothing authored"', () => {
  it('answers 204, not 200-with-null, when there is genuinely nothing', async () => {
    /**
     * The client treats 204 as "nothing yet" and shows an empty state WITH a create button. Pressing
     * it PUTs a new id, and because "current" is keyed per athlete, an artefact that merely failed to
     * load would be replaced by an empty one. So 204 must mean nothing exists — never a transient
     * failure, which must be a 5xx.
     */
    const response = await request('/workflows/current')
    expect(
      [200, 204].includes(response.status),
      `expected 200 or 204, got ${String(response.status)}`,
    ).toBe(true)

    if (response.status === 204) {
      expect(response.text, 'a 204 must have an empty body').toBe('')
    } else {
      expect(response.body, 'a 200 must carry the artefact, not null').not.toBeNull()
    }
  })

  it('PUT with an unknown id CREATES rather than 404ing', async () => {
    // ADR-0010 requires client-generated ids, so a first save is always a PUT to an id the server has
    // never seen. A 404 here would make every create impossible.
    const id = newId()
    const created = await request(`/workflows/${id}`, {
      method: 'PUT',
      body: {
        id,
        title: 'conformance',
        enabled: false,
        nodes: [{ id: newId(), kind: 'trigger', detail: 'conformance', x: 0, y: 0 }],
        edges: [],
      },
    })
    expect(
      created.status,
      `PUT to an unknown id must create; got ${String(created.status)}: ${created.text}`,
    ).toBe(200)
  })
})

// ─── helpers ────────────────────────────────────────────────────────────────────────────────────



/** Publish an event through whatever control the target exposes. Tolerated if absent. */
const emitEvent = async (): Promise<void> => {
  await request(`${origin()}/api/v1/__emit`, {
    method: 'POST',
    body: { kind: 'session-logged' },
  }).catch(() => undefined)
}

/**
 * Read a stream for a bounded time and return the raw text.
 *
 * Bounded rather than awaiting a frame count, because "nothing arrives" IS one of the findings — a
 * check that waited for a frame would hang instead of reporting §5.2.
 */
const readStream = async (
  ms: number,
  options: { lastEventId?: string; header?: boolean; emit?: boolean } = {},
): Promise<string> => {
  const url = new URL(`${baseUrl()}/events`)
  if (options.lastEventId !== undefined && options.header !== true) {
    url.searchParams.set('last-event-id', options.lastEventId)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, ms)

  const headers: Record<string, string> = { accept: 'text/event-stream', ...currentCookie() }
  if (options.lastEventId !== undefined && options.header === true) {
    headers['last-event-id'] = options.lastEventId
  }

  let text = ''
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (options.emit !== false) void emitEvent()
    const reader = response.body?.getReader()
    if (reader === undefined) return ''
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    // Aborting is how this returns; the text collected so far is the result.
  } finally {
    clearTimeout(timer)
  }
  return text
}

/** The event ids seen in a raw stream body. */
const idsIn = (raw: string): string[] =>
  raw
    .split('\n')
    .filter((line) => line.startsWith('id:'))
    .map((line) => line.slice('id:'.length).trim())
