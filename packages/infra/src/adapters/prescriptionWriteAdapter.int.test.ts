import { ProgramConflictError, type ReviseProgramInput } from '@fitnessos/ctx-prescription'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHttpClient } from '../http/client'
import { ApiError, ContractViolationError } from '../http/errors'
import { createPrescriptionWriteAdapter } from './prescriptionAdapter'

const BASE = 'http://api.test/api/v1'
const PROGRAM_ID = '018f2c8a-0003-7000-8000-000000000001'
const PATH = `${BASE}/programs/${PROGRAM_ID}/versions`

const PROGRAM = {
  id: PROGRAM_ID,
  athleteId: '018f2c8a-0000-7000-8000-000000000002',
  title: 'Base strength',
  currentVersion: {
    id: '018f2c8a-0004-7000-8000-000000000009',
    programId: PROGRAM_ID,
    versionNumber: 4,
    blocks: [
      {
        id: '018f2c8a-0005-7000-8000-000000000001',
        name: 'Preparation',
        order: 0,
        progressionIntent: { kind: 'fixed' },
      },
    ],
    authoringDecision: { decidedBy: 'coach-1', proposedBy: 'human' },
  },
}

// Cast through `unknown` because the id fields are branded and these are literals. The cast is
// confined to the fixture; every assertion below is against the real port type.
const INPUT = {
  programId: PROGRAM_ID,
  id: '018f2c8a-0004-7000-8000-000000000009',
  baseVersionId: '018f2c8a-0004-7000-8000-000000000008',
  blocks: [
    {
      id: '018f2c8a-0005-7000-8000-000000000001',
      name: 'Preparation',
      order: 0,
      progression: { kind: 'fixed', ratePercent: null },
    },
  ],
  servesGoal: null,
  authoredBy: { decidedBy: 'coach-1', proposedBy: 'human' },
} as unknown as ReviseProgramInput

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
  createPrescriptionWriteAdapter(createHttpClient({ baseUrl: BASE, mode: 'browser' }), {})

describe('the request body', () => {
  it('drops ratePercent for a non-linear block rather than sending null', async () => {
    // The contract constrains ratePercent to > 0, so a literal `null` fails validation on every
    // fixed block — a request the server refuses for a field the coach never filled in.
    let body: unknown
    server.use(
      http.post(PATH, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(PROGRAM, { status: 201 })
      }),
    )

    await adapter().revise(INPUT)

    const blocks = (body as { blocks: { progressionIntent: Record<string, unknown> }[] }).blocks
    expect(blocks[0]!.progressionIntent).toEqual({ kind: 'fixed' })
    expect(blocks[0]!.progressionIntent).not.toHaveProperty('ratePercent')
  })

  it('drops servesGoal entirely when there is none', async () => {
    let body: Record<string, unknown> = {}
    server.use(
      http.post(PATH, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(PROGRAM, { status: 201 })
      }),
    )

    await adapter().revise(INPUT)

    expect(body).not.toHaveProperty('servesGoal')
    expect(body['baseVersionId']).toBe(INPUT.baseVersionId)
  })

  it('refuses to send a body the contract rejects', async () => {
    // Validated on the way OUT, not only on the way in. A malformed request that reaches the
    // server comes back as a 400 with no indication of which field, three layers from the cause.
    server.use(http.post(PATH, () => HttpResponse.json(PROGRAM, { status: 201 })))

    const bad = { ...INPUT, blocks: [{ ...INPUT.blocks[0]!, name: '' }] }
    await expect(adapter().revise(bad)).rejects.toBeInstanceOf(ContractViolationError)
  })
})

describe('the three statuses', () => {
  it('201 is the new programme', async () => {
    server.use(http.post(PATH, () => HttpResponse.json(PROGRAM, { status: 201 })))
    const program = await adapter().revise(INPUT)
    expect(program.currentVersion.versionNumber).toBe(4)
  })

  it('200 — a replay of the same id — is indistinguishable from success', async () => {
    // The point of a client-generated id (ADR-0010): a revision whose response was lost can be
    // retried, and the retry must not read as an error or create a second version.
    server.use(http.post(PATH, () => HttpResponse.json(PROGRAM, { status: 200 })))
    await expect(adapter().revise(INPUT)).resolves.toMatchObject({ id: PROGRAM_ID })
  })

  it('409 carries the programme as it now stands', async () => {
    // The body is the whole value of the conflict. `request` would have turned this into an
    // ApiError and discarded it, leaving the author told they collided but not with what.
    server.use(http.post(PATH, () => HttpResponse.json(PROGRAM, { status: 409 })))

    await expect(adapter().revise(INPUT)).rejects.toBeInstanceOf(ProgramConflictError)
    await expect(adapter().revise(INPUT)).rejects.toMatchObject({
      current: { currentVersion: { versionNumber: 4 } },
    })
  })

  it('a 409 body that is not a Program is a contract violation, not a conflict', async () => {
    // Mapped before the status is inspected, so a malformed body is reported as what it is —
    // a disagreement between the API and the spec — rather than surfacing in the conflict UI
    // as a programme with missing fields.
    server.use(http.post(PATH, () => HttpResponse.json({ nope: true }, { status: 409 })))
    await expect(adapter().revise(INPUT)).rejects.toBeInstanceOf(ContractViolationError)
  })

  it('other failures still throw ApiError', async () => {
    server.use(
      http.post(PATH, () =>
        HttpResponse.json({ code: 'forbidden', detail: 'not your programme' }, { status: 403 }),
      ),
    )
    await expect(adapter().revise(INPUT)).rejects.toBeInstanceOf(ApiError)
  })
})
