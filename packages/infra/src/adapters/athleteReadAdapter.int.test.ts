import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { toBase } from '@fitnessos/kernel'
import { createHttpClient } from '../http/client'
import { ApiError, ContractViolationError } from '../http/errors'
import { createAthleteReadAdapter } from './athleteReadAdapter'

/**
 * Integration tier: the adapter, the http client, the mapper and the contract, all
 * exercised together against a mocked network.
 *
 * What this catches that a unit test cannot: the mapper being wrong about the shape
 * the backend actually sends. A unit test that hands `athleteFrom` a hand-built
 * object proves only that the mapper is self-consistent — the object was built from
 * the same assumption the mapper encodes.
 */

const BASE = 'http://api.test/api/v1'

const ATHLETE_PAYLOAD = {
  id: '018f2c8a-0000-7000-8000-000000000001',
  personId: '018f2c8a-0000-7000-8000-000000000002',
  status: 'active',
  trainingIdentity: {
    experienceLevel: 'intermediate',
    trainingAgeMonths: 18,
    disciplines: ['strength'],
  },
  availability: {
    daysPerWeek: 4,
    sessionCeilingSeconds: 4200,
    equipmentAccess: ['barbell', 'rack'],
  },
}

const server = setupServer()

// `error` rather than `warn`: an unhandled request means the test escaped to the
// real network, and a test that quietly hits a live host is worse than a failing one.
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
  createAthleteReadAdapter(createHttpClient({ baseUrl: BASE, mode: 'server' }), {})

describe('athlete read adapter', () => {
  it('maps a contract payload to the application snapshot', async () => {
    server.use(http.get(`${BASE}/athletes/me`, () => HttpResponse.json(ATHLETE_PAYLOAD)))

    const athlete = await adapter().getMine()

    expect(athlete.id).toBe(ATHLETE_PAYLOAD.id)
    expect(athlete.status).toBe('active')
    expect(athlete.trainingIdentity.experienceLevel).toBe('intermediate')
    expect(athlete.availability.daysPerWeek).toBe(4)
    // The contract's bare `sessionCeilingSeconds` became a dimensioned Quantity.
    // This is the N11 conversion the mapper exists to force.
    expect(athlete.availability.sessionCeiling).not.toBeNull()
    expect(toBase(athlete.availability.sessionCeiling!)).toBe(4200)
  })

  it('represents an absent session ceiling as null, not zero', async () => {
    // Zero would mean "cannot train at all" and would be acted on as a constraint.
    const availability = {
      daysPerWeek: ATHLETE_PAYLOAD.availability.daysPerWeek,
      equipmentAccess: ATHLETE_PAYLOAD.availability.equipmentAccess,
    }
    server.use(
      http.get(`${BASE}/athletes/me`, () =>
        HttpResponse.json({ ...ATHLETE_PAYLOAD, availability }),
      ),
    )

    const athlete = await adapter().getMine()
    expect(athlete.availability.sessionCeiling).toBeNull()
  })

  it('represents an absent training age as null rather than dropping the field', async () => {
    server.use(
      http.get(`${BASE}/athletes/me`, () =>
        HttpResponse.json({
          ...ATHLETE_PAYLOAD,
          trainingIdentity: { experienceLevel: 'beginner', disciplines: [] },
        }),
      ),
    )

    const athlete = await adapter().getMine()
    expect(athlete.trainingIdentity.trainingAgeMonths).toBeNull()
  })

  it('rejects with a typed ApiError carrying the problem code', async () => {
    server.use(
      http.get(`${BASE}/athletes/me`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not found', status: 404, code: 'athlete_not_found' },
          { status: 404 },
        ),
      ),
    )

    await expect(adapter().getMine()).rejects.toMatchObject({
      status: 404,
      code: 'athlete_not_found',
    })
    await expect(adapter().getMine()).rejects.toBeInstanceOf(ApiError)
  })

  it('propagates a 401 in server mode without attempting a refresh', async () => {
    // The refresh path is browser-only; see the note in http/client.ts. If this
    // starts calling /auth/refresh, MSW fails it as an unhandled request — which is
    // exactly the signal wanted.
    server.use(http.get(`${BASE}/athletes/me`, () => new HttpResponse(null, { status: 401 })))

    await expect(adapter().getMine()).rejects.toMatchObject({ status: 401 })
  })

  it('aborts in flight when the signal is aborted', async () => {
    server.use(
      http.get(`${BASE}/athletes/me`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return HttpResponse.json(ATHLETE_PAYLOAD)
      }),
    )

    const controller = new AbortController()
    const pending = adapter().getMine(controller.signal)
    controller.abort()

    // TanStack Query cancels in-flight queries on unmount, so the signal has to be
    // wired through the adapter and the client or every navigation leaks a request.
    await expect(pending).rejects.toThrow()
  })
})

describe('contract validation (ADR-0031)', () => {
  // `Record<string, unknown>` rather than `unknown`: MSW's `HttpResponse.json`
  // constrains its argument to a JSON-serialisable type, which is right — a test
  // helper that accepted `unknown` would let a non-serialisable value through and
  // fail inside MSW rather than at the call site.
  const serve = (body: Record<string, unknown>) => {
    server.use(http.get(`${BASE}/athletes/me`, () => HttpResponse.json(body)))
  }

  it('rejects a response missing a required field, naming the path', async () => {
    // Without validation this returned an object with `personId: undefined`, which
    // surfaced as a blank field or a crash several layers away from the cause.
    const withoutPersonId: Record<string, unknown> = { ...ATHLETE_PAYLOAD }
    delete withoutPersonId['personId']
    serve(withoutPersonId)

    await expect(adapter().getMine()).rejects.toBeInstanceOf(ContractViolationError)
    await expect(adapter().getMine()).rejects.toMatchObject({
      resource: 'Athlete',
      issues: [{ path: 'personId' }],
    })
  })

  it('rejects a field of the wrong type', async () => {
    serve({ ...ATHLETE_PAYLOAD, availability: { ...ATHLETE_PAYLOAD.availability, daysPerWeek: '4' } })

    await expect(adapter().getMine()).rejects.toMatchObject({
      issues: [{ path: 'availability.daysPerWeek' }],
    })
  })

  it('rejects an enum value the contract does not declare', async () => {
    // This is the hole the vocabulary map could not close on its own:
    // `STATUS[c.status]` on an undeclared value returns undefined, and an athlete
    // with `status: undefined` then flows through the whole application.
    serve({ ...ATHLETE_PAYLOAD, status: 'hibernating' })

    await expect(adapter().getMine()).rejects.toMatchObject({
      issues: [{ path: 'status' }],
    })
  })

  it('rejects a violated numeric constraint from the spec', async () => {
    // `daysPerWeek` is 1..7 in the spec. A validator that only checked types would
    // let 99 through, and nothing downstream re-checks it.
    serve({ ...ATHLETE_PAYLOAD, availability: { ...ATHLETE_PAYLOAD.availability, daysPerWeek: 99 } })

    await expect(adapter().getMine()).rejects.toBeInstanceOf(ContractViolationError)
  })

  it('TOLERATES an unknown field the backend added, and strips it', async () => {
    // The other half of the contract, and the reason the generated schemas are not
    // `.strict()`. A backend deploying an additive change must not break the
    // frontend — tolerant reader, strict writer. If this test ever fails, someone has
    // made the schemas strict and coupled every frontend release to every backend one.
    serve({ ...ATHLETE_PAYLOAD, somethingNewTheBackendAdded: { nested: true } })

    const athlete = await adapter().getMine()
    expect(athlete.status).toBe('active')
    expect(athlete).not.toHaveProperty('somethingNewTheBackendAdded')
  })

  it('distinguishes a contract violation from an API error', async () => {
    // An ApiError is a condition to render; a ContractViolationError is a defect to
    // report. An error boundary has to be able to tell them apart.
    serve({ ...ATHLETE_PAYLOAD, status: 'hibernating' })
    await expect(adapter().getMine()).rejects.not.toBeInstanceOf(ApiError)
  })
})
