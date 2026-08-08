import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { PhoneNumber } from '@fitnessos/core/auth'
import { createHttpClient } from '../http/client'
import { ApiError, ContractViolationError } from '../http/errors'
import { createAuthAdapter } from './authAdapter'

const BASE = 'http://api.test/api/v1'
const PHONE = '+989123456789' as PhoneNumber

const server = setupServer()
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})
afterEach(() => {
  server.resetHandlers()
})
afterAll(() => {
  server.close()
})

const adapter = () => createAuthAdapter(createHttpClient({ baseUrl: BASE, mode: 'browser' }))

describe('auth adapter — request code', () => {
  it('posts the E.164 phone and maps the result', async () => {
    let sent: unknown = null
    server.use(
      http.post(`${BASE}/auth/request-code`, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({ retryAfterSeconds: 60, codeLength: 6 })
      }),
    )

    const result = await adapter().requestCode(PHONE)

    expect(sent).toEqual({ phone: '+989123456789' })
    expect(result).toEqual({ retryAfterSeconds: 60, codeLength: 6 })
  })

  it('surfaces a 429 as an ApiError carrying the code', async () => {
    // Rate limiting is expected on this endpoint, not exceptional. The UI needs to
    // tell "too many attempts" apart from "that did not work".
    server.use(
      http.post(`${BASE}/auth/request-code`, () =>
        HttpResponse.json({ code: 'rate_limited', detail: 'try again shortly' }, { status: 429 }),
      ),
    )

    await expect(adapter().requestCode(PHONE)).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
    })
    await expect(adapter().requestCode(PHONE)).rejects.toBeInstanceOf(ApiError)
  })

  it('rejects a response missing codeLength rather than defaulting it', async () => {
    // A defaulted length would render an input that silently truncates or refuses a
    // correct code — a failure the user cannot diagnose or work around.
    server.use(
      http.post(`${BASE}/auth/request-code`, () => HttpResponse.json({ retryAfterSeconds: 60 })),
    )

    await expect(adapter().requestCode(PHONE)).rejects.toBeInstanceOf(ContractViolationError)
  })
})

describe('auth adapter — verify code', () => {
  it('posts phone and code, and maps the session', async () => {
    let sent: unknown = null
    server.use(
      http.post(`${BASE}/auth/verify-code`, async ({ request }) => {
        sent = await request.json()
        return HttpResponse.json({
          personId: '018f2c8a-0000-7000-8000-000000000002',
          isNewPerson: false,
        })
      }),
    )

    const session = await adapter().verifyCode(PHONE, '123456')

    expect(sent).toEqual({ phone: '+989123456789', code: '123456' })
    expect(session.personId).toBe('018f2c8a-0000-7000-8000-000000000002')
    expect(session.isNewPerson).toBe(false)
  })

  it('returns no token — the session is cookie-only', async () => {
    // A token in the response body is a token readable from JavaScript, and therefore
    // exfiltrable by XSS. If this assertion ever fails, someone has added one.
    server.use(
      http.post(`${BASE}/auth/verify-code`, () =>
        HttpResponse.json({
          personId: '018f2c8a-0000-7000-8000-000000000002',
          isNewPerson: true,
          accessToken: 'leaked.jwt.here',
        }),
      ),
    )

    const session = await adapter().verifyCode(PHONE, '123456')
    expect(Object.keys(session).sort()).toEqual(['isNewPerson', 'personId'])
  })

  it('propagates a wrong code as a 400 without retrying', async () => {
    let attempts = 0
    server.use(
      http.post(`${BASE}/auth/verify-code`, () => {
        attempts += 1
        return HttpResponse.json({ code: 'code_invalid', detail: 'nope' }, { status: 400 })
      }),
    )

    await expect(adapter().verifyCode(PHONE, '000000')).rejects.toMatchObject({ status: 400 })
    // One attempt. Retrying a wrong code burns the small number of server-side
    // attempts the user gets and locks them out of their own sign-in.
    expect(attempts).toBe(1)
  })

  it('does not attempt a token refresh on 401', async () => {
    // There is no session yet, so there is nothing to refresh. If the client tried,
    // MSW would fail the test as an unhandled request to /auth/refresh.
    server.use(
      http.post(`${BASE}/auth/verify-code`, () => new HttpResponse(null, { status: 401 })),
    )

    await expect(adapter().verifyCode(PHONE, '123456')).rejects.toMatchObject({ status: 401 })
  })
})
