import {
  CheckInFormConflictError,
  type CheckInFormSnapshot,
  type RecordObservationInput,
} from '@fitnessos/ctx-measurement'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHttpClient } from '../http/client'
import { ApiError, ContractViolationError } from '../http/errors'
import { createMeasurementAdapter } from './measurementAdapter'

const BASE = 'http://api.test/api/v1'

const FORM_ID = '018f2c8a-0009-7000-8000-000000000001'
const FORM_PATH = `${BASE}/check-in-forms/${FORM_ID}`

const FORM = {
  id: FORM_ID,
  title: 'Weekly check-in',
  fields: [
    {
      id: '018f2c8a-0009-7000-8000-000000000002',
      label: 'Morning bodyweight',
      records: 'bodyweight',
      unit: 'kg',
      answer: { kind: 'number' },
      order: 0,
    },
  ],
}

const SNAPSHOT = {
  id: FORM_ID,
  title: 'Weekly check-in',
  fields: [
    {
      id: '018f2c8a-0009-7000-8000-000000000002',
      label: 'Morning bodyweight',
      records: 'bodyweight',
      unit: 'kg',
      answer: { kind: 'number' },
      order: 0,
    },
  ],
} as unknown as CheckInFormSnapshot

const OBSERVATION = {
  id: '018f2c8a-0008-7000-8000-000000000001',
  athleteId: '018f2c8a-0000-7000-8000-000000000002',
  kind: 'bodyweight',
  value: 82.4,
  unit: 'kg',
  observedOn: '2026-08-10',
  acquisition: { kind: 'self-reported' },
}

const INPUT = {
  id: '018f2c8a-0008-7000-8000-000000000001',
  kind: 'bodyweight',
  value: 82.4,
  unit: 'kg',
  observedOn: { year: 2026, month: 8, day: 10 },
  acquisition: { kind: 'self-reported', source: null, recordedBy: null },
} as unknown as RecordObservationInput

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
  createMeasurementAdapter(createHttpClient({ baseUrl: BASE, mode: 'browser' }), {})

describe('reading observations', () => {
  it('maps an ISO date to a PlainDate without going through Date', async () => {
    // `new Date("2026-08-10")` is UTC midnight, so west of Greenwich it renders as the 9th — a
    // measurement taken on Monday shown as Sunday, for some athletes and not others.
    server.use(http.get(`${BASE}/observations`, () => HttpResponse.json([OBSERVATION])))

    const [observation] = await adapter().observations()
    expect(observation!.observedOn).toEqual({ year: 2026, month: 8, day: 10 })
  })

  it('normalises absent provenance fields to null', async () => {
    // `undefined` and `null` render differently, compare differently and serialise differently.
    // Normalising at the boundary means nothing downstream has to know which the wire used.
    server.use(http.get(`${BASE}/observations`, () => HttpResponse.json([OBSERVATION])))

    const [observation] = await adapter().observations()
    expect(observation!.acquisition).toEqual({
      kind: 'self-reported',
      source: null,
      recordedBy: null,
    })
  })

  it('accepts an indicator kind this build has never heard of', async () => {
    // The vocabulary is open (ADR-0020). A client that refused an unknown kind would be the
    // thing that has to ship before a practitioner can record a new measurement.
    server.use(
      http.get(`${BASE}/observations`, () =>
        HttpResponse.json([{ ...OBSERVATION, kind: 'grip-strength', unit: 'kg' }]),
      ),
    )
    const [observation] = await adapter().observations()
    expect(observation!.kind).toBe('grip-strength')
  })

  it('reports a response that does not match the contract', async () => {
    server.use(http.get(`${BASE}/observations`, () => HttpResponse.json([{ nope: true }])))
    await expect(adapter().observations()).rejects.toBeInstanceOf(ContractViolationError)
  })
})

describe('reading indicators', () => {
  it('carries the unit on the series and the movement name when present', async () => {
    server.use(
      http.get(`${BASE}/indicators`, () =>
        HttpResponse.json([
          {
            kind: 'estimated-1rm',
            unit: 'kg',
            movementName: 'Back squat',
            points: [{ on: '2026-08-10', value: 116.7 }],
          },
        ]),
      ),
    )

    const [series] = await adapter().indicators()
    expect(series!.unit).toBe('kg')
    expect(series!.movementName).toBe('Back squat')
    expect(series!.points[0]!.on).toEqual({ year: 2026, month: 8, day: 10 })
  })

  it('normalises an absent movement name to null', async () => {
    server.use(
      http.get(`${BASE}/indicators`, () =>
        HttpResponse.json([{ kind: 'bodyweight', unit: 'kg', points: [] }]),
      ),
    )
    const [series] = await adapter().indicators()
    expect(series!.movementName).toBeNull()
  })
})

describe('saving the check-in form', () => {
  it('sends the revision it read and returns the new one', async () => {
    let body: { baseRevision?: unknown } = {}
    server.use(
      http.put(FORM_PATH, async ({ request }) => {
        body = (await request.json()) as { baseRevision?: unknown }
        return HttpResponse.json({ ...FORM, revision: 8 })
      }),
    )

    const saved = await adapter().saveCheckInForm(SNAPSHOT, 7)
    expect(body.baseRevision).toBe(7)
    expect(saved.revision).toBe(8)
  })

  it('409 carries the form as it now stands', async () => {
    // The body is the whole value of the conflict. `request` would have turned this into an
    // ApiError and discarded it, leaving the author told they collided but not with what.
    server.use(
      http.put(FORM_PATH, () =>
        HttpResponse.json({ ...FORM, title: 'Weekly check-in (v2)', revision: 9 }, { status: 409 }),
      ),
    )

    await expect(adapter().saveCheckInForm(SNAPSHOT, 7)).rejects.toBeInstanceOf(
      CheckInFormConflictError,
    )
    await expect(adapter().saveCheckInForm(SNAPSHOT, 7)).rejects.toMatchObject({
      current: { artefact: { title: 'Weekly check-in (v2)' }, revision: 9 },
    })
  })

  it('a 409 body that is not a CheckInForm is a contract violation, not a conflict', async () => {
    // Mapped before the status is inspected, so a malformed body is reported as what it is — a
    // disagreement between the API and the spec — rather than reaching the conflict UI as a form
    // with no fields, which the author would read as "they deleted everything".
    server.use(http.put(FORM_PATH, () => HttpResponse.json({ nope: true }, { status: 409 })))
    await expect(adapter().saveCheckInForm(SNAPSHOT, 7)).rejects.toBeInstanceOf(
      ContractViolationError,
    )
  })

  it('other failures still throw ApiError', async () => {
    server.use(
      http.put(FORM_PATH, () =>
        HttpResponse.json({ code: 'forbidden', detail: 'not your athlete' }, { status: 403 }),
      ),
    )
    await expect(adapter().saveCheckInForm(SNAPSHOT, 7)).rejects.toBeInstanceOf(ApiError)
  })
})

describe('recording', () => {
  it('drops null provenance fields rather than sending them', async () => {
    // `source` is constrained to a non-empty string, so `source: null` on a self-report is
    // refused by the server for a field the athlete never filled in.
    let body: { acquisition: Record<string, unknown> } = { acquisition: {} }
    server.use(
      http.post(`${BASE}/observations`, async ({ request }) => {
        body = (await request.json()) as { acquisition: Record<string, unknown> }
        return HttpResponse.json(OBSERVATION, { status: 201 })
      }),
    )

    await adapter().record(INPUT)

    expect(body.acquisition).toEqual({ kind: 'self-reported' })
    expect(body.acquisition).not.toHaveProperty('source')
  })

  it('formats the date without going through Date', async () => {
    let body: { observedOn?: string } = {}
    server.use(
      http.post(`${BASE}/observations`, async ({ request }) => {
        body = (await request.json()) as { observedOn?: string }
        return HttpResponse.json(OBSERVATION, { status: 201 })
      }),
    )

    await adapter().record(INPUT)
    expect(body.observedOn).toBe('2026-08-10')
  })

  it('treats a 200 replay as success, indistinguishable from a 201', async () => {
    // A duplicate measurement can only be a retry — unlike a session log, which may be a genuine
    // second record from another device and therefore answers 409.
    server.use(http.post(`${BASE}/observations`, () => HttpResponse.json(OBSERVATION)))
    await expect(adapter().record(INPUT)).resolves.toMatchObject({ kind: 'bodyweight' })
  })

  it('refuses to send a body the contract rejects', async () => {
    server.use(http.post(`${BASE}/observations`, () => HttpResponse.json(OBSERVATION, { status: 201 })))
    const bad = { ...INPUT, unit: '' } as RecordObservationInput
    await expect(adapter().record(bad)).rejects.toBeInstanceOf(ContractViolationError)
  })
})
