import type { APIRequestContext, BrowserContext } from '@playwright/test'

/**
 * Build an athlete's state through the REAL API, so a browser test has something to look at.
 *
 * ## Why this exists
 *
 * `apps/web/e2e/` is written against the stub's fixtures: fault injection through `__fault`, and a
 * phone number whose last digit decides whether you have a programme. None of that is a thing the
 * Rust backend does, so the whole 295-test suite verifies the product against a server that is not
 * the one being shipped. `docs/v2/local-production-readiness.md` records that as blocker (d).
 *
 * The stub's shortcut cannot simply be copied — the real backend has no seeding endpoint and should
 * not have one, for the reason `create_program`'s docstring gives: an endpoint that exists for tests
 * is an endpoint that ships. So state is built the way an athlete builds it, through the published
 * API, and anything the API cannot create is honestly out of reach here.
 *
 * ## What is NOT reachable, and why that is the point
 *
 * There is no `POST /proposals`. Proposals arrive from the assistant, and nothing in the contract
 * lets a client create one — so the unjudged-hypotheses screen cannot be exercised against the real
 * backend without reaching into SQL, which would make this a test of a fixture again. It is listed
 * as a gap rather than faked.
 */

/** UUIDv7 — client-generated, per ADR-0010, because a retry after a lost response must be safe. */
export const newId = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  const millis = BigInt(Date.now())
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((millis >> BigInt(8 * (5 - i))) & 0xffn)
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * A number nobody else in this database has used.
 *
 * The clock ALONE is not enough: Playwright runs these files across two workers, so two tests can
 * call this inside the same millisecond and end up sharing an athlete — which presents as one test
 * seeing the other's programme, and reads as a backend bug. Four random digits on the end make that
 * collision a coincidence rather than a race.
 */
export const freshPhone = (): string => {
  const clock = String(Date.now()).slice(-7)
  const salt = String(Math.floor(Math.random() * 10_000)).padStart(4, '0')
  return `0912${clock}${salt}`.slice(0, 11)
}

/**
 * ASCII digits to Persian ones, for the fields the UI renders in Persian numerals.
 *
 * `replace` rather than spreading the string: `[...s]` yields code points and `.split('')` yields
 * UTF-16 units, and both mangle anything outside the BMP. Only digits are being touched here, so
 * neither hazard applies — but a regex says that in the code instead of in a comment nobody reads.
 */
export const toPersianDigits = (ascii: string): string =>
  ascii.replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)] ?? digit)

export interface SeededAthlete {
  readonly phone: string
  readonly programId: string
  readonly versionId: string
  readonly sessionId: string
  readonly itemId: string
}

const base = (origin: string) => `${origin}/api/v1`

/**
 * Sign in and complete onboarding, returning the cookies the browser will need.
 *
 * The OTP is the fixed development code. `Config::from_env` refuses to start with `DEV_OTP_CODE` set
 * when `APP_ENV=production`, so this backdoor cannot reach a deployment — which is what makes it
 * safe to depend on here.
 */
export const signInThroughApi = async (
  request: APIRequestContext,
  origin: string,
  phone: string,
  otp: string,
): Promise<void> => {
  const requested = await request.post(`${base(origin)}/auth/request-code`, { data: { phone } })
  if (!requested.ok()) throw new Error(`request-code: ${String(requested.status())}`)

  const verified = await request.post(`${base(origin)}/auth/verify-code`, {
    data: { phone, code: otp },
  })
  if (!verified.ok()) throw new Error(`verify-code: ${String(verified.status())}`)

  const onboarded = await request.put(`${base(origin)}/athletes/me/onboarding`, {
    data: {
      trainingIdentity: { experienceLevel: 'intermediate', disciplines: ['strength'] },
      availability: { daysPerWeek: 4, sessionCeilingSeconds: 4200, equipmentAccess: ['barbell'] },
    },
  })
  if (!onboarded.ok()) throw new Error(`onboarding: ${String(onboarded.status())}`)
}

/**
 * A programme with one block, and one session prescribed for today.
 *
 * `scheduledFor` is today rather than a fixed date, because `/sessions/upcoming` filters on it and a
 * fixture pinned to a date in the past is a test that silently stops covering anything.
 *
 * The block carries the OBJECT form of `progressionIntent`. The string form used to be accepted and
 * stored, which is how every programme the real API produced became unreadable to the client — see
 * `domain/program.rs`.
 */
export const seedProgramme = async (
  request: APIRequestContext,
  origin: string,
  today: string,
): Promise<Omit<SeededAthlete, 'phone'>> => {
  const programId = newId()
  const blockId = newId()

  const created = await request.post(`${base(origin)}/programs`, {
    data: {
      id: programId,
      title: 'Base',
      blocks: [
        { id: blockId, name: 'Accumulation', order: 0,
          progressionIntent: { kind: 'linear', ratePercent: 2.5 } },
      ],
      authoringDecision: { decidedBy: 'self', proposedBy: 'human' },
    },
  })
  if (created.status() !== 201) throw new Error(`create programme: ${String(created.status())}`)

  const current = await request.get(`${base(origin)}/programs/current`)
  const programme = (await current.json()) as { currentVersion: { id: string } }

  const sessionId = newId()
  const itemId = newId()
  const prescribed = await request.post(`${base(origin)}/programs/${programId}/sessions`, {
    data: {
      id: sessionId,
      scheduledFor: today,
      items: [{ id: itemId, movementName: 'Back squat', order: 0, sets: 5, reps: 5, loadKg: 100 }],
      screening: { level: 'clear' },
    },
  })
  if (prescribed.status() !== 201) throw new Error(`prescribe: ${String(prescribed.status())}`)

  return { programId, versionId: programme.currentVersion.id, sessionId, itemId }
}

/**
 * Hand the browser the session the API request context is holding.
 *
 * Playwright's `request` fixture and its browser context keep separate cookie jars, so a sign-in
 * done over HTTP is invisible to the page unless the cookies are copied across. Copied rather than
 * re-signing-in, because a second `request-code` inside the 60-second cooldown is refused — by
 * design (§3.8, server-authoritative), and it would look like a broken test.
 */
export const handSessionToBrowser = async (
  request: APIRequestContext,
  context: BrowserContext,
): Promise<void> => {
  const { cookies } = await request.storageState()
  await context.addCookies(cookies)
}
