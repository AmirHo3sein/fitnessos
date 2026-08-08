#!/usr/bin/env node
/**
 * Stub API for e2e and local development.
 *
 * ADR-0026 leaves the real backend in another repository, so the frontend's critical
 * paths could be asserted only as far as the client could get alone: the e2e suite
 * could prove a phone number was normalised, but not that a correct code establishes
 * a session, and not that a forged cookie is refused. Those are the two assertions
 * that actually matter.
 *
 * **This process is never part of the app build.** It is a separate server started by
 * Playwright and by `pnpm dev:api`, reached through a rewrite that exists only when
 * `STUB_API_URL` is set. A Route Handler inside `apps/web` would have been less code
 * and a much worse idea — an endpoint that returns fabricated athlete data must not be
 * capable of existing in a production bundle.
 *
 * ## The one property that makes a stub trustworthy
 *
 * Every response is validated against the SAME generated Zod schema the client
 * validates it with (ADR-0031), before it is sent. A stub that drifts from the
 * contract is worse than no stub: the suite goes green against a shape the real
 * backend will never produce, and the divergence is discovered in production.
 *
 * So a handler that returns the wrong shape fails here, loudly, with the field path —
 * rather than being caught client-side and reported as a generic error, or worse,
 * matching a client that has drifted the same way.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import {
  AthleteSchema,
  CompleteOnboardingBodySchema,
  DeclareGoalBodySchema,
  GoalSchema,
  PrescribedSessionSchema,
  ProblemSchema,
  ProgramSchema,
  RequestCodeBodySchema,
  RequestCodeResultSchema,
  VerifyCodeBodySchema,
  VerifyCodeResultSchema,
} from '../../packages/contracts/src/schemas.gen.ts'

const PORT = Number(process.env['STUB_API_PORT'] ?? 8791)

/**
 * Fixed fixtures. A stub with random data makes a failing test unreproducible, and
 * `Math.random()` in a fixture is how a suite becomes flaky without anyone changing it.
 */
/**
 * State is keyed by PHONE, so each phone is a distinct athlete.
 *
 * The first version held one mutable athlete for the whole process, which is a flake
 * generator under `fullyParallel`: the onboarding spec writes `advanced`/5 days while
 * the sign-in spec asserts `intermediate` on the dashboard, and whichever ran first
 * decided the result. Keying by phone means a test gets its own athlete simply by using
 * its own number — no reset endpoint, no serialisation, no shared fixture to reason
 * about.
 *
 * Ids are derived from the phone rather than generated, so a failure is reproducible
 * and a log line identifies which test wrote what.
 */
const idsFor = (phone: string) => {
  const suffix = phone.replace(/\D/g, '').slice(-9).padStart(12, '0')
  return {
    personId: `018f2c8a-0000-7000-8000-${suffix}`,
    athleteId: `018f2c8a-0001-7000-8000-${suffix}`,
  }
}

/** The only code that verifies. Anything else is rejected, so both paths are testable. */
const GOOD_CODE = '000000'

/** A phone ending in these digits is treated as new, so onboarding is reachable. */
const NEW_PERSON_SUFFIX = '0000'

interface StubAthlete {
  id: string
  personId: string
  status: string
  trainingIdentity: { experienceLevel: string; trainingAgeMonths?: number; disciplines: string[] }
  availability: { daysPerWeek: number; sessionCeilingSeconds?: number; equipmentAccess: string[] }
}

const athletes = new Map<string, StubAthlete>()

interface StubGoal {
  id: string
  athleteId: string
  intent: string
  declaredOn: string
  horizon?: string
  cadenceDays: number
}

/** Keyed by phone, for the same isolation reason as athletes. */
const goals = new Map<string, StubGoal[]>()

/**
 * A phone whose last digit is 9 gets a programme; everyone else gets none.
 *
 * Both paths need covering and neither is an error: "no programme yet" is the normal state for
 * a newly-onboarded athlete. Keying it off the phone rather than a mutable flag keeps the
 * choice deterministic and per-test, the same reason athlete state is keyed by phone.
 */
const hasProgramme = (phone: string) => phone.endsWith('9')

const programmeFor = (phone: string) => {
  const { personId, athleteId } = idsFor(phone)
  const versionId = `018f2c8a-0004-7000-8000-${phone.replace(/\D/g, '').slice(-12)}`
  return {
    id: `018f2c8a-0003-7000-8000-${phone.replace(/\D/g, '').slice(-12)}`,
    athleteId: personId,
    title: 'Base strength',
    currentVersion: {
      id: versionId,
      programId: `018f2c8a-0003-7000-8000-${phone.replace(/\D/g, '').slice(-12)}`,
      versionNumber: 2,
      // Deliberately supplied OUT of order, so the mapper's sort is exercised rather than
      // assumed. The contract promises no ordering.
      blocks: [
        { id: '018f2c8a-0005-7000-8000-000000000002', name: 'Accumulation', order: 1,
          progressionIntent: { kind: 'linear', ratePercent: 2.5 } },
        { id: '018f2c8a-0005-7000-8000-000000000001', name: 'Preparation', order: 0,
          progressionIntent: { kind: 'fixed' } },
      ],
      authoringDecision: { decidedBy: 'coach-1', proposedBy: 'human', rationale: 'base phase' },
    },
    _athleteId: athleteId,
  }
}

const sessionsFor = (phone: string) => {
  const digits = phone.replace(/\D/g, '').slice(-12)
  return [
    {
      id: `018f2c8a-0006-7000-8000-${digits}`,
      programVersionId: `018f2c8a-0004-7000-8000-${digits}`,
      scheduledFor: '2026-08-10',
      items: [
        { id: '018f2c8a-0007-7000-8000-000000000002', movementName: 'Back squat', order: 1,
          sets: 5, reps: 5, loadKg: 100 },
        // No loadKg: bodyweight. Absent, never 0 -- the mapper normalises to null.
        { id: '018f2c8a-0007-7000-8000-000000000001', movementName: 'Push-up', order: 0,
          sets: 3, reps: 12 },
      ],
      // A MODIFIED verdict with a withheld basis, which is the case worth covering: the athlete
      // must be told the session was modified AND that the reason is not theirs to see
      // (ADR-0002 / ADR-0014). Saying nothing would imply it is unexplained.
      screening: { level: 'modified', basisWithheld: true },
    },
  ]
}

const athleteFor = (phone: string): StubAthlete => {
  const existing = athletes.get(phone)
  if (existing) return existing

  const { personId, athleteId } = idsFor(phone)
  const fresh: StubAthlete = {
    id: athleteId,
    personId,
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
  athletes.set(phone, fresh)
  return fresh
}

/**
 * The token the stub issues. Deliberately NOT a real JWT and obviously not one — a stub
 * that mints something JWT-shaped invites someone to point a real client at it.
 *
 * Carries the phone, which is how a request is resolved back to its athlete. A real
 * backend would look the session up; this keeps the whole thing stateless apart from the
 * athlete map.
 */
const issuedToken = (phone: string) => `stub.${phone.replace(/\D/g, '')}`

/** The phone a presented access token belongs to, or null if it was not issued here. */
const phoneFromToken = (token: string | undefined): string | null => {
  if (token === undefined || !token.startsWith('stub.')) return null
  const digits = token.slice('stub.'.length)
  return /^[0-9]{12}$/.test(digits) ? `+${digits}` : null
}

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

const cookiesOf = (req: IncomingMessage): Record<string, string> => {
  const header = req.headers.cookie ?? ''
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name) out[name] = rest.join('=')
  }
  return out
}

/**
 * Send a validated JSON response.
 *
 * The schema argument is not optional and there is no unvalidated `send`. Making the
 * safe path the only path is the same discipline the client applies to responses —
 * a stub that could skip validation would, on the one handler someone added in a hurry.
 */
const send = <T>(
  res: ServerResponse,
  status: number,
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  body: T,
  headers: Record<string, string | string[]> = {},
): void => {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    console.error('✖ stub produced a response that violates its own contract:')
    console.error(JSON.stringify(parsed.error, null, 2))
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: 'stub_contract_violation', detail: 'see stub logs' }))
    return
  }
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

const problem = (res: ServerResponse, status: number, code: string, detail: string): void => {
  send(res, status, ProblemSchema, { code, detail })
}

/**
 * `SameSite=Lax` and `HttpOnly`, matching what production must set. `Secure` is
 * omitted because e2e runs over http on localhost, and a Secure cookie would simply
 * not be stored — the suite would then pass or fail for a reason unrelated to the code
 * under test.
 */
const sessionCookies = (phone: string): string[] => [
  `access_token=${issuedToken(phone)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
  `refresh_token=refresh.${phone.replace(/\D/g, '')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
]

const handlers: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> = {
  'POST /api/v1/auth/request-code': async (req, res) => {
    const body = RequestCodeBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      // The client normalises before sending, so a malformed phone here means the
      // client's normalisation is broken — exactly what should fail a test.
      problem(res, 400, 'invalid_request', 'phone must be E.164 (+989XXXXXXXXX)')
      return
    }
    send(res, 200, RequestCodeResultSchema, { retryAfterSeconds: 60, codeLength: 6 })
  },

  'POST /api/v1/auth/verify-code': async (req, res) => {
    const body = VerifyCodeBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', 'phone and code are required')
      return
    }
    const { phone, code } = body.data as { phone: string; code: string }

    if (code !== GOOD_CODE) {
      problem(res, 400, 'code_invalid', 'that code is not correct')
      return
    }

    const { personId } = idsFor(phone)
    send(
      res,
      200,
      VerifyCodeResultSchema,
      { personId, isNewPerson: phone.endsWith(NEW_PERSON_SUFFIX) },
      { 'set-cookie': sessionCookies(phone) },
    )
  },

  'POST /api/v1/auth/refresh': async (req, res) => {
    const refresh = cookiesOf(req)['refresh_token']
    const digits = refresh?.startsWith('refresh.') ? refresh.slice('refresh.'.length) : ''
    if (!/^[0-9]{12}$/.test(digits)) {
      res.writeHead(401).end()
      return
    }
    // Strict rotation: a new pair, and the old refresh token is conceptually revoked.
    res.writeHead(204, { 'set-cookie': sessionCookies(`+${digits}`) })
    res.end()
  },

  'PUT /api/v1/athletes/me/onboarding': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    const body = CompleteOnboardingBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      // The client validates outbound too, so a rejection here means the outbound
      // mapper is wrong — which is exactly what should fail a test rather than be
      // absorbed as a generic error.
      problem(res, 400, 'invalid_request', 'trainingIdentity and availability required')
      return
    }

    const { trainingIdentity, availability } = body.data as Pick<
      StubAthlete,
      'trainingIdentity' | 'availability'
    >
    // PUT is idempotent: the same body twice leaves the same state.
    const updated: StubAthlete = { ...athleteFor(phone), trainingIdentity, availability }
    athletes.set(phone, updated)
    send(res, 200, AthleteSchema, updated)
  },

  'GET /api/v1/goals': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    // Validated per element, same as the client does, so a bad fixture fails here.
    const list = goals.get(phone) ?? []
    for (const g of list) {
      const parsed = GoalSchema.safeParse(g)
      if (!parsed.success) {
        console.error('stub produced an invalid Goal', parsed.error)
        res.writeHead(500).end()
        return
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(list))
  },

  'POST /api/v1/goals': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    const body = DeclareGoalBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', 'intent and cadenceDays are required')
      return
    }
    const { intent, horizon, cadenceDays } = body.data as {
      intent: string
      horizon?: string
      cadenceDays: number
    }

    const athlete = athleteFor(phone)
    const existing = goals.get(phone) ?? []
    const declared: StubGoal = {
      // Deterministic, so a failure is reproducible. The index is enough: goals are
      // per-phone and each test uses its own number.
      id: `018f2c8a-0002-7000-8000-${String(existing.length).padStart(12, '0')}`,
      athleteId: athlete.personId,
      // Verbatim. Normalising here would hide a client that failed to normalise.
      intent,
      // A calendar fact. Derived from the server's own date, never from the client's.
      declaredOn: new Date().toISOString().slice(0, 10),
      ...(horizon === undefined ? {} : { horizon }),
      cadenceDays,
    }
    goals.set(phone, [...existing, declared])
    send(res, 201, GoalSchema, declared)
  },

  'GET /api/v1/programs/current': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    if (!hasProgramme(phone)) {
      // 204, which the adapter maps to null. "No programme yet" is data, not an error.
      res.writeHead(204).end()
      return
    }
    const { _athleteId: _unused, ...programme } = programmeFor(phone)
    send(res, 200, ProgramSchema, programme)
  },

  'GET /api/v1/sessions/upcoming': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const list = hasProgramme(phone) ? sessionsFor(phone) : []
    for (const session of list) {
      const parsed = PrescribedSessionSchema.safeParse(session)
      if (!parsed.success) {
        console.error('stub produced an invalid PrescribedSession', parsed.error)
        res.writeHead(500).end()
        return
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(list))
  },

  'GET /api/v1/athletes/me': async (req, res) => {
    // The check that makes the forged-cookie e2e meaningful. A cookie that is present
    // but not one this server issued is refused — which is what the real backend does
    // with a signature it cannot verify, and what the middleware deliberately does not
    // attempt to do itself.
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    send(res, 200, AthleteSchema, athleteFor(phone))
  },
}

createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0] ?? ''
  const handler = handlers[`${req.method ?? 'GET'} ${path}`]

  if (!handler) {
    // 501, not 404. A 404 is a legitimate answer the client renders; this means the
    // stub has not implemented something the app now calls, and that should be
    // distinguishable at a glance in a test failure.
    console.warn(`stub: no handler for ${req.method ?? '?'} ${path}`)
    res.writeHead(501, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: 'not_stubbed', detail: `${req.method ?? '?'} ${path}` }))
    return
  }

  handler(req, res).catch((error: unknown) => {
    console.error('stub handler threw:', error)
    res.writeHead(500).end()
  })
}).listen(PORT, () => {
  console.log(`stub api on http://127.0.0.1:${String(PORT)}`)
  console.log(`  code that verifies: ${GOOD_CODE}`)
  console.log(`  phone ending ${NEW_PERSON_SUFFIX} is treated as a new person`)
  console.log('  state is keyed by phone — each number is a distinct athlete')
  console.log('  a phone ending in 9 has a programme; others have none')
})
