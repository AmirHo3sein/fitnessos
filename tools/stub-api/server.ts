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
  LogSessionBodySchema,
  PerformedSessionSchema,
  PrescribedSessionSchema,
  ProblemSchema,
  ProgramSchema,
  RequestCodeBodySchema,
  CheckInFormSchema,
  DashboardSchema,
  DecisionOutcomeSchema,
  NutritionPlanSchema,
  PlanSchema,
  ReportSchema,
  IndicatorSeriesSchema,
  ObservationSchema,
  ProposalSchema,
  RenderVerdictBodySchema,
  RecordObservationBodySchema,
  RequestCodeResultSchema,
  ReviseProgramBodySchema,
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
 * Performed sessions, keyed by phone then by the CLIENT-supplied id.
 *
 * Keying by the client's id is what implements the idempotency contract in ADR-0033: a replayed
 * mutation arrives with an id already present and gets 409 with the stored record, rather than
 * creating a second session. Offline replay is at-least-once, and this is the whole mechanism
 * that makes that safe.
 */
const performed = new Map<string, Map<string, unknown>>()

/** Which prescribed sessions already have a log, for the first-write-wins conflict rule. */
const loggedPrescribed = new Map<string, Map<string, string>>()

/**
 * Revisions, keyed by phone. `versions` is keyed by the CLIENT-supplied version id, which is what
 * makes a replayed revision return the stored programme instead of creating a second one.
 */
const revisions = new Map<string, { current: unknown; versions: Map<string, unknown> }>()

/** Recorded measurements, keyed by phone then by the CLIENT-supplied id (ADR-0010). */
const observations = new Map<string, Map<string, unknown>>()

/** Check-in forms, one per phone. Replaced wholesale by PUT — a form is not versioned. */
const checkInForms = new Map<string, unknown>()

/** Reports, one per phone. Same reasoning: a report owns a layout and nothing references it. */
const reports = new Map<string, unknown>()

/** Dashboards, one per phone. Replaced wholesale, like the form and the report. */
const dashboards = new Map<string, unknown>()

/** Nutrition plans, one per phone. Same wholesale replace. */
const nutritionPlans = new Map<string, unknown>()

/** Plans, one per phone. Same wholesale replace. */
const plans = new Map<string, unknown>()

/**
 * Deliberate faults, per phone and per route.
 *
 * ## Why this exists
 *
 * The client makes promises about its worst moments — "your changes are still here", "we could
 * not load this", a session that expires and lands you on sign-in — and none of them had ever
 * been observed working, because nothing could be made to fail on demand. The alternative was
 * test-only code in the product, which is worse than an untested path.
 *
 * The fault belongs HERE, in the process that is already a fabrication. `tools/stub-api` never
 * ships anywhere; making it lie on request costs the product nothing.
 *
 * Keyed by phone so faults are per-test and cannot leak between parallel workers, the same way
 * every other piece of state in this file is.
 */
type Fault = 'server-error' | 'malformed' | 'unauthorized' | 'rate-limited'
const faults = new Map<string, Map<string, Fault>>()

const faultFor = (phone: string | null, routeKey: string): Fault | null =>
  phone === null ? null : (faults.get(phone)?.get(routeKey) ?? null)

/** Rendered verdicts, keyed by phone then by client id. Superseded ones are KEPT (ADR-0007). */
const outcomes = new Map<string, Map<string, unknown>>()

/**
 * A proposal every athlete has, accepted, whose horizon has already passed.
 *
 * Seeded rather than generated so the unjudged-hypothesis view has something real to surface on
 * the first request. Dates are fixed, because a fixture computed from today's date makes a
 * failure unreproducible tomorrow.
 */
const proposalsFor = (phone: string) => {
  const digits = phone.replace(/\D/g, '').slice(-12)
  return [
    {
      id: `018f2c8a-000b-7000-8000-${digits}`,
      targetKind: 'program',
      targetId: `018f2c8a-0003-7000-8000-${digits}`,
      summary: 'Raise the accumulation block to 5% per cycle',
      rationale: 'Both recent blocks finished at the top of the prescribed range',
      hypothesis: {
        indicatorKind: 'estimated-1rm',
        claim: 'Back squat estimate rises by at least 5kg',
        horizon: '2026-01-10',
      },
      proposedOn: '2025-12-01',
      decidedOn: '2025-12-02',
      accepted: true,
    },
    {
      id: `018f2c8a-000c-7000-8000-${digits}`,
      targetKind: 'program',
      targetId: `018f2c8a-0003-7000-8000-${digits}`,
      summary: 'Add a deload week before the next block',
      rationale: 'Session RPE has risen for three consecutive weeks at the same load',
      hypothesis: {
        indicatorKind: 'estimated-1rm',
        claim: 'The estimate holds rather than falling through the deload',
        horizon: '2027-06-01',
      },
      proposedOn: '2026-08-01',
    },
  ]
}

/**
 * A phone whose last digit is 9 gets a programme; everyone else gets none.
 *
 * Both paths need covering and neither is an error: "no programme yet" is the normal state for
 * a newly-onboarded athlete. Keying it off the phone rather than a mutable flag keeps the
 * choice deterministic and per-test, the same reason athlete state is keyed by phone.
 */
const hasProgramme = (phone: string) => phone.endsWith('9')

/** The programme as it now stands: the seed, unless a revision replaced it. */
const currentProgrammeFor = (phone: string): Record<string, unknown> => {
  const revised = revisions.get(phone)?.current
  if (revised !== undefined) return revised as Record<string, unknown>
  const { _athleteId: _unused, ...programme } = programmeFor(phone)
  return programme
}

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
      /*
       * Points at the id `POST /goals` assigns to an athlete's FIRST goal.
       *
       * One seed, both D-08 paths, no extra state: an athlete who has declared a goal gets a
       * reference that resolves, and one who has not gets a reference that is broken. Which is
       * also the truth about the product — a programme can outlive the goal it was written for.
       */
      servesGoal: {
        goalId: '018f2c8a-0002-7000-8000-000000000000',
        rationale: 'base phase before the build-up',
      },
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
    send(res, 200, ProgramSchema, currentProgrammeFor(phone))
  },

  'GET /api/v1/sessions/upcoming': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const logged = loggedPrescribed.get(phone) ?? new Map<string, string>()
    // A logged session is no longer upcoming. Without this the list still shows a session the
    // athlete finished, which reads as the app not having noticed.
    const list = hasProgramme(phone)
      ? sessionsFor(phone).filter((session) => !logged.has(session.id))
      : []
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

  /**
   * Wipe all state. Called once before the e2e suite.
   *
   * Keying by phone isolates tests from each other WITHIN a run; it does nothing across runs,
   * because Playwright reuses a running stub locally (`reuseExistingServer`). A session logged by
   * yesterday's run is still logged today, so a test that expects an unlogged session finds none —
   * which fails as "button not found", several steps from the cause.
   *
   * An explicit reset is better than per-run random phones: it keeps failures reproducible, and it
   * makes the statefulness visible rather than something a future test has to rediscover.
   */
  'POST /__reset': async (_req, res) => {
    athletes.clear()
    goals.clear()
    performed.clear()
    loggedPrescribed.clear()
    revisions.clear()
    observations.clear()
    outcomes.clear()
    checkInForms.clear()
    reports.clear()
    dashboards.clear()
    plans.clear()
    nutritionPlans.clear()
    faults.clear()
    res.writeHead(204).end()
    return Promise.resolve()
  },

  'POST /api/v1/sessions/performed': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    const body = LogSessionBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', 'a performed session requires id, prescribedSessionId, performedOn and at least one set')
      return
    }
    const log = body.data as { id: string; prescribedSessionId: string }

    const mine = performed.get(phone) ?? new Map<string, unknown>()
    const byPrescribed = loggedPrescribed.get(phone) ?? new Map<string, string>()

    // Same id replayed — the at-least-once case. Return the STORED record, not an error body: the
    // client treats 409 as success and needs the canonical version.
    const existingById = mine.get(log.id)
    if (existingById !== undefined) {
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end(JSON.stringify(existingById))
      return
    }

    // Different id, same prescribed session — another device logged it first. First write wins;
    // the client keeps its own copy and surfaces the difference (ADR-0033).
    const winnerId = byPrescribed.get(log.prescribedSessionId)
    if (winnerId !== undefined) {
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end(JSON.stringify(mine.get(winnerId)))
      return
    }

    mine.set(log.id, log)
    byPrescribed.set(log.prescribedSessionId, log.id)
    performed.set(phone, mine)
    loggedPrescribed.set(phone, byPrescribed)

    send(res, 201, PerformedSessionSchema, log)
  },

  'POST /api/v1/programs/:programId/versions': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    const body = ReviseProgramBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_body', body.error.issues[0]?.message ?? 'invalid')
      return
    }

    const state = revisions.get(phone) ?? { current: undefined, versions: new Map() }
    const stored = state.versions.get(body.data.id)
    if (stored !== undefined) {
      // The same revision replayed after a lost response. 200 with what was stored, never a
      // second version — this is the client-generated-id contract in ADR-0010, and the whole
      // reason `id` is in the body at all.
      send(res, 200, ProgramSchema, stored)
      return
    }

    const current = currentProgrammeFor(phone) as {
      currentVersion: { id: string; versionNumber: number }
    }
    if (body.data.baseVersionId !== current.currentVersion.id) {
      // Someone else revised first. 409 with the programme AS IT NOW STANDS, so the client can
      // show the author what they collided with rather than only that they collided.
      send(res, 409, ProgramSchema, current)
      return
    }

    const revised = {
      ...current,
      currentVersion: {
        id: body.data.id,
        programId: (current as unknown as { id: string }).id,
        // Assigned HERE, by the lineage. A client that sent its own would race another author.
        versionNumber: current.currentVersion.versionNumber + 1,
        blocks: body.data.blocks,
        ...(body.data.servesGoal === undefined ? {} : { servesGoal: body.data.servesGoal }),
        authoringDecision: body.data.authoringDecision,
      },
    }

    state.versions.set(body.data.id, revised)
    state.current = revised
    revisions.set(phone, state)
    send(res, 201, ProgramSchema, revised)
  },

  'GET /api/v1/observations': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const list = [...(observations.get(phone) ?? new Map()).values()]
    for (const record of list) {
      const parsed = ObservationSchema.safeParse(record)
      if (!parsed.success) {
        problem(res, 500, 'bad_fixture', 'an observation fixture does not match the contract')
        return
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list))
  },

  'POST /api/v1/observations': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    const body = RecordObservationBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', body.error.issues[0]?.message ?? 'invalid')
      return
    }

    const mine = observations.get(phone) ?? new Map<string, unknown>()
    const stored = mine.get(body.data.id)
    if (stored !== undefined) {
      // The same id replayed. 200 with the stored record, never a second one — a duplicate
      // measurement can only be a retry, unlike a duplicate session log which may be a genuine
      // second record from another device.
      send(res, 200, ObservationSchema, stored)
      return
    }

    const record = { ...body.data, athleteId: idsFor(phone).personId }
    mine.set(body.data.id, record)
    observations.set(phone, mine)
    send(res, 201, ObservationSchema, record)
  },

  'GET /api/v1/indicators': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    /*
     * DERIVED here, on every request, from what is stored (ADR-0006). Nothing writes an
     * indicator, and there is no indicator table — which is what makes the loop in ADR-0024
     * observable end to end: log a session and the estimated 1RM moves without a measurement
     * being recorded at all.
     */
    const series: unknown[] = []

    const bodyweight = [...(observations.get(phone) ?? new Map()).values()]
      .filter((o): o is { kind: string; observedOn: string; value: number; unit: string } =>
        typeof o === 'object' && o !== null && (o as { kind?: unknown }).kind === 'bodyweight')
    if (bodyweight.length > 0) {
      series.push({
        kind: 'bodyweight',
        unit: bodyweight[0]!.unit,
        points: bodyweight.map((o) => ({ on: o.observedOn, value: o.value })),
      })
    }

    // Epley, matching `core/measurement/domain/oneRepMax.ts`. The client holds the same formula
    // so it can show an estimate offline before this endpoint has seen the session.
    const logs = [...(performed.get(phone) ?? new Map()).values()] as {
      performedOn: string
      sets: { reps: number; loadKg?: number }[]
    }[]
    const points = logs
      .map((log) => {
        let best = 0
        for (const set of log.sets) {
          if (set.loadKg === undefined || set.reps > 12) continue
          const estimate = set.reps === 1 ? set.loadKg : set.loadKg * (1 + set.reps / 30)
          if (estimate > best) best = estimate
        }
        return best > 0 ? { on: log.performedOn, value: Math.round(best * 10) / 10 } : null
      })
      .filter((p): p is { on: string; value: number } => p !== null)

    if (points.length > 0) {
      series.push({
        kind: 'estimated-1rm',
        unit: 'kg',
        movementName: 'Back squat',
        points,
      })
    }

    for (const one of series) {
      const parsed = IndicatorSeriesSchema.safeParse(one)
      if (!parsed.success) {
        problem(res, 500, 'bad_fixture', 'a derived series does not match the contract')
        return
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(series))
  },

  /**
   * Arm a fault. Test-only, and alongside `__reset` rather than under `/api/v1` so it can never
   * be mistaken for part of the contract.
   */
  'POST /__fault': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const body = (await readBody(req)) as { route?: string; fault?: Fault }
    if (typeof body.route !== 'string' || body.fault === undefined) {
      problem(res, 400, 'invalid_request', 'route and fault are required')
      return
    }
    const mine = faults.get(phone) ?? new Map<string, Fault>()
    mine.set(body.route, body.fault)
    faults.set(phone, mine)
    res.writeHead(204).end()
  },

  'GET /api/v1/check-in-forms/current': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const form = checkInForms.get(phone)
    if (form === undefined) {
      // 204, which the adapter maps to null. "No form yet" is data, not an error.
      res.writeHead(204).end()
      return
    }
    send(res, 200, CheckInFormSchema, form)
  },

  'PUT /api/v1/check-in-forms/:formId': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    const body = CheckInFormSchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', body.error.issues[0]?.message ?? 'invalid')
      return
    }

    // A wholesale replace. Submitting the same body twice leaves the form in the same state,
    // which is what makes PUT correct here and a retry safe with no client-generated id.
    checkInForms.set(phone, body.data)
    send(res, 200, CheckInFormSchema, body.data)
  },

  'GET /api/v1/reports/current': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const stored = reports.get(phone)
    if (stored === undefined) {
      res.writeHead(204).end()
      return
    }
    send(res, 200, ReportSchema, stored)
  },

  'PUT /api/v1/reports/:reportId': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    const body = ReportSchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', body.error.issues[0]?.message ?? 'invalid')
      return
    }

    // Stored verbatim, tile order included — it is PAINT order, and reordering it here would
    // rearrange what the coach composed.
    reports.set(phone, body.data)
    send(res, 200, ReportSchema, body.data)
  },

  'GET /api/v1/dashboards/current': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const stored = dashboards.get(phone)
    if (stored === undefined) {
      res.writeHead(204).end()
      return
    }
    send(res, 200, DashboardSchema, stored)
  },

  'PUT /api/v1/dashboards/:dashboardId': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const body = DashboardSchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', body.error.issues[0]?.message ?? 'invalid')
      return
    }
    dashboards.set(phone, body.data)
    send(res, 200, DashboardSchema, body.data)
  },

  'GET /api/v1/plans/current': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const stored = plans.get(phone)
    if (stored === undefined) {
      res.writeHead(204).end()
      return
    }
    send(res, 200, PlanSchema, stored)
  },

  'PUT /api/v1/plans/:planId': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const body = PlanSchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', body.error.issues[0]?.message ?? 'invalid')
      return
    }
    plans.set(phone, body.data)
    send(res, 200, PlanSchema, body.data)
  },

  'GET /api/v1/nutrition-plans/current': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const stored = nutritionPlans.get(phone)
    if (stored === undefined) {
      res.writeHead(204).end()
      return
    }
    send(res, 200, NutritionPlanSchema, stored)
  },

  'PUT /api/v1/nutrition-plans/:planId': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const body = NutritionPlanSchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', body.error.issues[0]?.message ?? 'invalid')
      return
    }
    nutritionPlans.set(phone, body.data)
    send(res, 200, NutritionPlanSchema, body.data)
  },

  'GET /api/v1/proposals': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    const list = proposalsFor(phone)
    for (const one of list) {
      const parsed = ProposalSchema.safeParse(one)
      if (!parsed.success) {
        problem(res, 500, 'bad_fixture', 'a proposal fixture does not match the contract')
        return
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list))
  },

  'GET /api/v1/outcomes': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    // Superseded outcomes included, deliberately. A correction that hid what it replaced would
    // make the correction invisible (ADR-0007).
    const list = [...(outcomes.get(phone) ?? new Map()).values()]
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list))
  },

  'POST /api/v1/proposals/:proposalId/outcome': async (req, res) => {
    const phone = phoneFromToken(cookiesOf(req)['access_token'])
    if (phone === null) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }

    const body = RenderVerdictBodySchema.safeParse(await readBody(req))
    if (!body.success) {
      problem(res, 400, 'invalid_request', body.error.issues[0]?.message ?? 'invalid')
      return
    }

    const proposalId = ((req.url ?? '').split('?')[0] ?? '').split('/')[4] ?? ''
    const mine = outcomes.get(phone) ?? new Map<string, unknown>()

    const stored = mine.get(body.data.id)
    if (stored !== undefined) {
      send(res, 200, DecisionOutcomeSchema, stored)
      return
    }

    const record = {
      id: body.data.id,
      proposalId,
      verdict: body.data.verdict,
      rationale: body.data.rationale,
      decidedBy: 'coach-1',
      decidedOn: new Date().toISOString().slice(0, 10),
      ...(body.data.supersedes === undefined ? {} : { supersedes: body.data.supersedes }),
    }
    // The superseded outcome is NOT removed. It stays readable, which is the whole point.
    mine.set(body.data.id, record)
    outcomes.set(phone, mine)
    send(res, 201, DecisionOutcomeSchema, record)
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
  const raw = (req.url ?? '').split('?')[0] ?? ''
  // Handlers are keyed by exact path, which is enough for every route but one. Rather than
  // introduce a router for a single parameterised path, the id is folded back into the literal
  // key it was written with — the id itself is not needed, since programme state is keyed by
  // phone like everything else here.
  const path = raw
    .replace(/^\/api\/v1\/programs\/[^/]+\/versions$/, '/api/v1/programs/:programId/versions')
    .replace(/^\/api\/v1\/proposals\/[^/]+\/outcome$/, '/api/v1/proposals/:proposalId/outcome')
    .replace(/^\/api\/v1\/check-in-forms\/(?!current$)[^/]+$/, '/api/v1/check-in-forms/:formId')
    .replace(/^\/api\/v1\/reports\/(?!current$)[^/]+$/, '/api/v1/reports/:reportId')
    .replace(/^\/api\/v1\/dashboards\/(?!current$)[^/]+$/, '/api/v1/dashboards/:dashboardId')
    .replace(/^\/api\/v1\/plans\/(?!current$)[^/]+$/, '/api/v1/plans/:planId')
    .replace(
      /^\/api\/v1\/nutrition-plans\/(?!current$)[^/]+$/,
      '/api/v1/nutrition-plans/:planId',
    )
  const routeKey = `${req.method ?? 'GET'} ${path}`
  const handler = handlers[routeKey]

  /*
   * A fault is checked BEFORE the handler, so an armed route never touches stored state. A fault
   * that ran the handler first would leave a session logged or a form saved while reporting a
   * failure, and the test after it would start from a state the product never produced.
   */
  const fault = faultFor(phoneFromToken(cookiesOf(req)['access_token']), routeKey)
  if (fault !== null) {
    if (fault === 'server-error') {
      problem(res, 500, 'internal_error', 'deliberate fault')
      return
    }
    if (fault === 'unauthorized') {
      // Every 401 the client cannot refresh past ends the session. Refresh is armed separately
      // so a test can choose between "recovers" and "signed out".
      problem(res, 401, 'unauthenticated', 'deliberate fault')
      return
    }
    if (fault === 'rate-limited') {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: 'rate_limited', detail: 'deliberate fault' }))
      return
    }
    // `malformed`: a 200 whose body does not match the published schema — the case ADR-0031
    // exists for, and the one no other test can produce. Shaped like a plausible near-miss
    // rather than nonsense, because that is what a real backend drift looks like.
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ unexpected: true, id: 'not-a-uuid' }))
    return
  }

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
