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
  ProblemSchema,
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
const PERSON_ID = '018f2c8a-0000-7000-8000-000000000002'
const ATHLETE_ID = '018f2c8a-0000-7000-8000-000000000001'

/** The only code that verifies. Anything else is rejected, so both paths are testable. */
const GOOD_CODE = '000000'

/** A phone ending in these digits is treated as new, so onboarding is reachable. */
const NEW_PERSON_SUFFIX = '0000'

const ATHLETE = {
  id: ATHLETE_ID,
  personId: PERSON_ID,
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

/**
 * The token the stub issues. Deliberately NOT a real JWT and obviously not one — a
 * stub that mints something JWT-shaped invites someone to point a real client at it.
 */
const issuedToken = (personId: string) => `stub.${personId}`

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
const sessionCookies = (personId: string): string[] => [
  `access_token=${issuedToken(personId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900`,
  `refresh_token=refresh.${personId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
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

    send(
      res,
      200,
      VerifyCodeResultSchema,
      { personId: PERSON_ID, isNewPerson: phone.endsWith(NEW_PERSON_SUFFIX) },
      { 'set-cookie': sessionCookies(PERSON_ID) },
    )
  },

  'POST /api/v1/auth/refresh': async (req, res) => {
    if (!cookiesOf(req)['refresh_token']) {
      res.writeHead(401).end()
      return
    }
    // Strict rotation: a new pair, and the old refresh token is conceptually revoked.
    res.writeHead(204, { 'set-cookie': sessionCookies(PERSON_ID) })
    res.end()
  },

  'GET /api/v1/athletes/me': async (req, res) => {
    // The check that makes the forged-cookie e2e meaningful. A cookie that is present
    // but not one this server issued is refused — which is what the real backend does
    // with a signature it cannot verify, and what the middleware deliberately does not
    // attempt to do itself.
    if (cookiesOf(req)['access_token'] !== issuedToken(PERSON_ID)) {
      problem(res, 401, 'unauthenticated', 'no valid session')
      return
    }
    send(res, 200, AthleteSchema, ATHLETE)
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
})
