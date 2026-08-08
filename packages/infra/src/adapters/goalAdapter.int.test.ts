import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHttpClient } from '../http/client'
import { ContractViolationError } from '../http/errors'
import { createGoalAdapter } from './goalAdapter'

const BASE = 'http://api.test/api/v1'

const GOAL = {
  id: '018f2c8a-0002-7000-8000-000000000001',
  athleteId: '018f2c8a-0000-7000-8000-000000000002',
  intent: 'می‌خواهم ۱۰ کیلومتر بدون توقف بدوم',
  declaredOn: '2026-08-08',
  horizon: '2026-11-06',
  cadenceDays: 28,
}

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

const adapter = () =>
  createGoalAdapter(createHttpClient({ baseUrl: BASE, mode: 'browser' }), {})

describe('goal adapter — dates', () => {
  it('maps an ISO date to a PlainDate without going through Date', async () => {
    // `new Date("2026-08-08")` parses as UTC midnight, so in a negative-offset zone it
    // renders as the 7th. A goal declared on the 8th would show as the day before, and a
    // horizon would shift by a day for some users and not others.
    server.use(http.get(`${BASE}/goals`, () => HttpResponse.json([GOAL])))

    const [goal] = await adapter().listMine()

    expect(goal!.declaredOn).toEqual({ year: 2026, month: 8, day: 8 })
    expect(goal!.horizon).toEqual({ year: 2026, month: 11, day: 6 })
  })

  it('represents an absent horizon as null, not as a date', async () => {
    // Open-ended is a real answer, and it must not become "today" or epoch.
    const openEnded: Record<string, unknown> = { ...GOAL }
    delete openEnded['horizon']
    server.use(http.get(`${BASE}/goals`, () => HttpResponse.json([openEnded])))

    const [goal] = await adapter().listMine()
    expect(goal!.horizon).toBeNull()
  })

  it('sends a PlainDate back as an ISO date, zero-padded', async () => {
    let sent: Record<string, unknown> | null = null
    server.use(
      http.post(`${BASE}/goals`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(GOAL, { status: 201 })
      }),
    )

    await adapter().declare({
      intent: 'Run 10k',
      // Single-digit month and day: without padding this becomes "2027-1-5", which the
      // contract's `format: date` rejects.
      horizon: { year: 2027, month: 1, day: 5 },
      cadenceDays: 28,
    })

    expect(sent!['horizon']).toBe('2027-01-05')
  })

  it('omits the horizon key entirely when open-ended', async () => {
    let sent: Record<string, unknown> | null = null
    server.use(
      http.post(`${BASE}/goals`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(GOAL, { status: 201 })
      }),
    )

    await adapter().declare({ intent: 'Run 10k', horizon: null, cadenceDays: 28 })

    // The contract marks it optional rather than nullable, and JSON has no undefined.
    expect(sent).not.toHaveProperty('horizon')
  })

  it('round-trips a date through send and receive unchanged', async () => {
    server.use(
      http.post(`${BASE}/goals`, () =>
        HttpResponse.json({ ...GOAL, horizon: '2027-01-05' }, { status: 201 }),
      ),
    )

    const goal = await adapter().declare({
      intent: 'Run 10k',
      horizon: { year: 2027, month: 1, day: 5 },
      cadenceDays: 28,
    })

    expect(goal.horizon).toEqual({ year: 2027, month: 1, day: 5 })
  })
})

describe('goal adapter — intent', () => {
  it('preserves the ZWNJ in a Persian intent through the mapper', async () => {
    // The mapper must not normalise prose. Stripping U+200C turns می‌خواهم into میخواهم,
    // which reads to a Persian speaker as a spelling error the product introduced.
    server.use(http.get(`${BASE}/goals`, () => HttpResponse.json([GOAL])))

    const [goal] = await adapter().listMine()
    expect(goal!.intent).toBe(GOAL.intent)
    expect(goal!.intent).toContain('‌')
  })

  it('does not normalise Persian digits inside the intent', async () => {
    // ۱۰ in a sentence is how a Persian speaker writes it. Converting to 10 would edit
    // the athlete's words.
    server.use(http.get(`${BASE}/goals`, () => HttpResponse.json([GOAL])))
    const [goal] = await adapter().listMine()
    expect(goal!.intent).toContain('۱۰')
  })
})

describe('goal adapter — validation', () => {
  it('rejects a response carrying a derived status field it should not have', async () => {
    // ADR-0006: staleness and expiry are derived, never stored. A `status` on the wire
    // would be a stored derivation, wrong by the time it arrived. The schema does not
    // declare it, so it is stripped rather than rejected — tolerant reader — and the
    // assertion is that it does not reach the application type.
    server.use(http.get(`${BASE}/goals`, () => HttpResponse.json([{ ...GOAL, status: 'expired' }])))

    const [goal] = await adapter().listMine()
    expect(goal).not.toHaveProperty('status')
  })

  it('rejects a cadence below the contract minimum', async () => {
    server.use(http.get(`${BASE}/goals`, () => HttpResponse.json([{ ...GOAL, cadenceDays: 1 }])))
    await expect(adapter().listMine()).rejects.toBeInstanceOf(ContractViolationError)
  })

  it('rejects an intent longer than the contract allows', async () => {
    server.use(
      http.get(`${BASE}/goals`, () =>
        HttpResponse.json([{ ...GOAL, intent: 'a'.repeat(201) }]),
      ),
    )
    await expect(adapter().listMine()).rejects.toBeInstanceOf(ContractViolationError)
  })

  it('rejects a non-array list response rather than treating it as empty', async () => {
    // An empty list and a broken response are different facts. Coercing the second into
    // the first would render "no goals yet" to an athlete who has goals.
    server.use(http.get(`${BASE}/goals`, () => HttpResponse.json({ goals: [GOAL] })))
    await expect(adapter().listMine()).rejects.toThrow(/not an array/)
  })

  it('validates the request before sending', async () => {
    // No handler: if it were sent, MSW would fail it as unhandled.
    await expect(
      adapter().declare({ intent: '', horizon: null, cadenceDays: 28 }),
    ).rejects.toMatchObject({ resource: 'DeclareGoalBody (request)' })
  })
})
