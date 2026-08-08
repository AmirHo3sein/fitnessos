import { type Mock, describe, expect, it, vi } from 'vitest'
import { createHttpClient } from './client'
import { ApiError, NetworkError } from './errors'

/**
 * The invariants here are the ones V1 got wrong, and the ones that fail
 * intermittently under load rather than deterministically in review.
 */

type FetchMock = Mock<typeof globalThis.fetch>

const json = (status: number, body: unknown): Promise<Response> =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )

const empty = (status: number): Promise<Response> =>
  Promise.resolve(new Response(null, { status }))

/**
 * `fetch` accepts string | URL | Request. `String(request)` yields
 * "[object Request]", so the union has to be narrowed rather than coerced —
 * the lint rule that flagged the naive version was right.
 */
const pathOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url

const isRefresh = (input: string | URL | Request): boolean =>
  pathOf(input).endsWith('/auth/refresh')

describe('happy path', () => {
  it('sends credentials and parses JSON', async () => {
    const fetchMock: FetchMock = vi.fn(() => json(200, { id: 'a1' }))
    const client = createHttpClient({ fetch: fetchMock })

    await expect(client.request('/athletes/me')).resolves.toEqual({ id: 'a1' })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(pathOf(url)).toBe('/api/v1/athletes/me')
    expect(init?.credentials).toBe('include')
  })

  it('returns undefined for 204 rather than trying to parse a body', async () => {
    const client = createHttpClient({ fetch: vi.fn(() => empty(204)) })
    await expect(client.request('/auth/refresh', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('forwards a cookie header for server-side prefetch', async () => {
    const fetchMock: FetchMock = vi.fn(() => json(200, {}))
    const client = createHttpClient({ fetch: fetchMock })

    await client.request('/athletes/me', { auth: { cookie: 'access_token=abc' } })

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>
    expect(headers['cookie']).toBe('access_token=abc')
  })

  it('omits the cookie header in browser mode', async () => {
    const fetchMock: FetchMock = vi.fn(() => json(200, {}))
    const client = createHttpClient({ fetch: fetchMock })

    await client.request('/athletes/me')

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>
    expect(headers['cookie']).toBeUndefined()
  })
})

describe('errors', () => {
  it('extracts a stable code and detail from a Problem body', async () => {
    const client = createHttpClient({
      fetch: vi.fn(() => json(409, { code: 'id_conflict', detail: 'already exists' })),
    })

    await expect(client.request('/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'id_conflict',
      message: 'already exists',
    })
  })

  it('does not stringify an array detail into [object Object]', async () => {
    // FastAPI-style validation errors return an array. V1 rendered that as
    // "[object Object]" in the UI.
    const client = createHttpClient({
      fetch: vi.fn(() => json(422, { detail: [{ loc: ['body', 'x'], msg: 'required' }] })),
    })

    const error: unknown = await client.request('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('request validation failed')
  })

  it('survives a non-JSON error body', async () => {
    const client = createHttpClient({
      fetch: vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 502 }))),
    })
    await expect(client.request('/x')).rejects.toBeInstanceOf(ApiError)
  })

  it('wraps transport failures distinctly from HTTP failures', async () => {
    const client = createHttpClient({
      fetch: vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    })
    await expect(client.request('/x')).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('refresh on 401 — the V1 defect', () => {
  it('refreshes once then retries the original request', async () => {
    let athleteCalls = 0
    const fetchMock: FetchMock = vi.fn((input) => {
      if (isRefresh(input)) return empty(204)
      athleteCalls += 1
      return athleteCalls === 1 ? json(401, { code: 'expired' }) : json(200, { id: 'a1' })
    })
    const client = createHttpClient({ fetch: fetchMock })

    await expect(client.request('/athletes/me')).resolves.toEqual({ id: 'a1' })
    expect(client.refresher.rotationCount()).toBe(1)
    expect(athleteCalls).toBe(2)
  })

  it('retries only once — a persistent 401 must not loop', async () => {
    const fetchMock: FetchMock = vi.fn((input) =>
      isRefresh(input) ? empty(204) : json(401, { code: 'expired' }),
    )
    const client = createHttpClient({ fetch: fetchMock })

    await expect(client.request('/athletes/me')).rejects.toMatchObject({ status: 401 })
    expect(client.refresher.rotationCount()).toBe(1)
  })

  it('surfaces the refresh failure, not the original 401', async () => {
    const onSessionLost = vi.fn()
    const fetchMock: FetchMock = vi.fn((input) =>
      isRefresh(input)
        ? json(401, { code: 'no_session', detail: 'Invalid or expired session.' })
        : json(401, { code: 'expired' }),
    )
    const client = createHttpClient({ fetch: fetchMock, onSessionLost })

    await expect(client.request('/athletes/me')).rejects.toMatchObject({ code: 'no_session' })
    expect(onSessionLost).toHaveBeenCalledOnce()
  })

  it('never attempts to refresh the refresh endpoint itself', async () => {
    const client = createHttpClient({ fetch: vi.fn(() => json(401, {})) })
    await expect(client.request('/auth/refresh', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
    })
    expect(client.refresher.rotationCount()).toBe(0)
  })
})

describe('single-flight refresh — the concurrency hazard', () => {
  it('rotates ONCE for many simultaneous 401s', async () => {
    // Strict rotation means each extra refresh revokes a session that was just
    // issued. Without serialisation this produces random logouts under load.
    let refreshCalls = 0
    const seen = new Set<string>()

    const fetchMock: FetchMock = vi.fn(async (input) => {
      const path = pathOf(input)
      if (isRefresh(input)) {
        refreshCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 10)) // rotation is not instant
        return empty(204)
      }
      if (seen.has(path)) return json(200, { path })
      seen.add(path)
      return json(401, { code: 'expired' })
    })

    const client = createHttpClient({ fetch: fetchMock })

    const results = await Promise.all([
      client.request<{ path: string }>('/a'),
      client.request<{ path: string }>('/b'),
      client.request<{ path: string }>('/c'),
      client.request<{ path: string }>('/d'),
      client.request<{ path: string }>('/e'),
    ])

    expect(results).toHaveLength(5)
    expect(refreshCalls).toBe(1)
    expect(client.refresher.rotationCount()).toBe(1)
  })

  it('allows a later refresh after an earlier one settles', async () => {
    // The in-flight promise must clear, or every request after the first refresh
    // window would attach to a stale settled promise.
    let refreshCalls = 0
    let failNext = true

    const fetchMock: FetchMock = vi.fn((input) => {
      if (isRefresh(input)) {
        refreshCalls += 1
        return empty(204)
      }
      if (failNext) {
        failNext = false
        return json(401, {})
      }
      return json(200, {})
    })

    const client = createHttpClient({ fetch: fetchMock })
    await client.request('/a')
    failNext = true
    await client.request('/b')

    expect(refreshCalls).toBe(2)
  })

  it('does not wedge subsequent requests after a failed refresh', async () => {
    let refreshShouldFail = true
    const fetchMock: FetchMock = vi.fn((input) =>
      isRefresh(input)
        ? refreshShouldFail
          ? json(401, { code: 'no_session' })
          : empty(204)
        : json(401, { code: 'expired' }),
    )

    const client = createHttpClient({ fetch: fetchMock })
    await expect(client.request('/a')).rejects.toMatchObject({ code: 'no_session' })

    // A rejected promise left in `inFlight` would make this hang, or reject with
    // the stale error forever.
    refreshShouldFail = false
    await expect(client.request('/b')).rejects.toMatchObject({ status: 401 })
    expect(client.refresher.rotationCount()).toBe(2)
  })
})

describe('server mode', () => {
  it('does NOT refresh on 401 — it lets the error propagate', async () => {
    // The bug this prevents is a silent logout on navigation.
    //
    // Refresh tokens rotate strictly, so a successful rotation revokes the token
    // presented. On the server the rotation can be performed but the resulting
    // Set-Cookie cannot reach the browser — an RSC render has no access to the
    // outgoing response headers. The new token is discarded, the old one is
    // already dead, and the user's next request fails to authenticate.
    const fetchMock: FetchMock = vi.fn(() => empty(401))
    const client = createHttpClient({
      fetch: fetchMock,
      mode: 'server',
      baseUrl: 'http://api.internal/api/v1',
    })

    await expect(client.request('/athletes/me')).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock.mock.calls.filter(([u]) => isRefresh(u))).toHaveLength(0)
    expect(client.refresher.rotationCount()).toBe(0)
  })

  it('forwards the cookie it was handed, since server fetch carries no session', async () => {
    const fetchMock: FetchMock = vi.fn(() => json(200, { id: 'a1' }))
    const client = createHttpClient({
      fetch: fetchMock,
      mode: 'server',
      baseUrl: 'http://api.internal/api/v1',
    })

    await client.request('/athletes/me', { auth: { cookie: 'access_token=abc' } })

    const [, init] = fetchMock.mock.calls[0]!
    expect(new Headers(init?.headers).get('cookie')).toBe('access_token=abc')
  })

  it('still refreshes in browser mode, which is the default', async () => {
    // Guards against "fixed the server path by disabling refresh everywhere".
    let calls = 0
    const fetchMock: FetchMock = vi.fn((input) => {
      if (isRefresh(input)) return empty(204)
      calls += 1
      return calls === 1 ? empty(401) : json(200, { id: 'a1' })
    })
    const client = createHttpClient({ fetch: fetchMock })

    await expect(client.request('/athletes/me')).resolves.toEqual({ id: 'a1' })
    expect(client.refresher.rotationCount()).toBe(1)
  })
})
