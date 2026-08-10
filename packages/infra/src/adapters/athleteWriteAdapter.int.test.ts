import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { toBase } from '@fitnessos/kernel'
import { createHttpClient } from '../http/client'
import { ContractViolationError } from '../http/errors'
import { createAthleteWriteAdapter } from './athleteWriteAdapter'

const BASE = 'http://api.test/api/v1'

const ATHLETE_RESPONSE = {
  id: '018f2c8a-0000-7000-8000-000000000001',
  personId: '018f2c8a-0000-7000-8000-000000000002',
  status: 'active',
  trainingIdentity: {
    experienceLevel: 'advanced',
    trainingAgeMonths: 60,
    disciplines: ['running', 'strength'],
  },
  availability: { daysPerWeek: 5, sessionCeilingSeconds: 3600, equipmentAccess: ['barbell'] },
}

const INPUT = {
  trainingIdentity: {
    experienceLevel: 'advanced',
    trainingAgeMonths: 60,
    disciplines: ['running', 'strength'] as readonly string[],
  },
  availability: {
    daysPerWeek: 5,
    sessionCeilingSeconds: 3600,
    equipmentAccess: ['barbell'] as readonly string[],
  },
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
  createAthleteWriteAdapter(createHttpClient({ baseUrl: BASE, mode: 'browser' }), {})

describe('athlete write adapter', () => {
  it('PUTs the onboarding body and maps the returned athlete', async () => {
    let method: string | null = null
    let sent: unknown = null
    server.use(
      http.put(`${BASE}/athletes/me/onboarding`, async ({ request }) => {
        method = request.method
        sent = await request.json()
        return HttpResponse.json(ATHLETE_RESPONSE)
      }),
    )

    const athlete = await adapter().completeOnboarding(INPUT)

    // PUT, not POST: the same body twice must leave the athlete in the same state,
    // because this is a form a user will resubmit after a network hiccup.
    expect(method).toBe('PUT')
    expect(sent).toEqual({
      trainingIdentity: {
        experienceLevel: 'advanced',
        trainingAgeMonths: 60,
        disciplines: ['running', 'strength'],
      },
      availability: { daysPerWeek: 5, sessionCeilingSeconds: 3600, equipmentAccess: ['barbell'] },
    })
    expect(athlete.trainingIdentity.experienceLevel).toBe('advanced')
    expect(toBase(athlete.availability.sessionCeiling!)).toBe(3600)
  })

  it('omits an absent training age rather than sending null', async () => {
    // The contract marks it OPTIONAL, not nullable, and JSON has no undefined. Sending
    // `trainingAgeMonths: null` would fail validation on a field the athlete left blank.
    let sent: Record<string, Record<string, unknown>> | null = null
    server.use(
      http.put(`${BASE}/athletes/me/onboarding`, async ({ request }) => {
        sent = (await request.json()) as Record<string, Record<string, unknown>>
        return HttpResponse.json(ATHLETE_RESPONSE)
      }),
    )

    await adapter().completeOnboarding({
      ...INPUT,
      trainingIdentity: { ...INPUT.trainingIdentity, trainingAgeMonths: null },
    })

    expect(sent!['trainingIdentity']).not.toHaveProperty('trainingAgeMonths')
  })

  it('omits an absent session ceiling rather than sending null', async () => {
    let sent: Record<string, Record<string, unknown>> | null = null
    server.use(
      http.put(`${BASE}/athletes/me/onboarding`, async ({ request }) => {
        sent = (await request.json()) as Record<string, Record<string, unknown>>
        return HttpResponse.json(ATHLETE_RESPONSE)
      }),
    )

    await adapter().completeOnboarding({
      ...INPUT,
      availability: { ...INPUT.availability, sessionCeilingSeconds: null },
    })

    expect(sent!['availability']).not.toHaveProperty('sessionCeilingSeconds')
  })

  it('validates the REQUEST before sending, so a mapper bug fails here not as a 400', async () => {
    // No handler registered: if the request were sent, MSW would fail it as unhandled.
    // It is never sent, because outbound validation rejects it first. That is the whole
    // value — the diagnostic is a field path rather than a status code and an operator
    // message.
    await expect(
      adapter().completeOnboarding({
        ...INPUT,
        availability: { ...INPUT.availability, daysPerWeek: 99 },
      }),
    ).rejects.toBeInstanceOf(ContractViolationError)
  })

  it('names the direction in the violation, so a request bug is not mistaken for a response bug', async () => {
    await expect(
      adapter().completeOnboarding({
        ...INPUT,
        trainingIdentity: { ...INPUT.trainingIdentity, experienceLevel: 'elite' },
      }),
    ).rejects.toMatchObject({ resource: 'CompleteOnboardingBody (request)' })
  })

  it('rejects a malformed RESPONSE too', async () => {
    server.use(
      http.put(`${BASE}/athletes/me/onboarding`, () =>
        HttpResponse.json({ ...ATHLETE_RESPONSE, status: 'hibernating' }),
      ),
    )

    await expect(adapter().completeOnboarding(INPUT)).rejects.toMatchObject({
      resource: 'Athlete',
    })
  })
})
