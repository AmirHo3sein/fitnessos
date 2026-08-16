import { beforeAll, describe, expect, it } from 'vitest'
import {
  AthleteSchema,
  CheckInFormSchema,
  DashboardSchema,
  DecisionOutcomeSchema,
  GoalSchema,
  IndicatorSeriesSchema,
  NutritionPlanSchema,
  PlanSchema,
  PrescribedSessionSchema,
  ProgramSchema,
  ProposalSchema,
  ReportSchema,
  WorkflowSchema,
} from '@fitnessos/contracts'
import type { ZodTypeAny } from 'zod'
import { request, signIn } from './client'

/**
 * Does what this server RETURNS match the shapes it publishes?
 *
 * ## Where this came from, stated accurately
 *
 * `ProposalSchema` gained a required `proposedBy` when Learning gained a proposer, and the stub's
 * seeded proposals were never updated. The nightly suite went red on 13 August and stayed red
 * through the 16th.
 *
 * The obvious lesson — "nothing was checking the fixture" — turned out to be **wrong**, and the
 * correction is worth writing down. The stub already validated that fixture against `ProposalSchema`
 * on the way out and answered `500 bad_fixture`, "a proposal fixture does not match the contract".
 * It named the cause exactly. The failure was that this diagnosis lived in an HTTP response body
 * inside a nightly run nobody read, and by the time somebody looked, the symptom they saw first was
 * `Cannot read properties of undefined` three layers away.
 *
 * The fix for THAT is the `report` job in `.github/workflows/scheduled.yml`, which opens an issue
 * when the nightly is red. This file is the smaller, second thing.
 *
 * ## What this file actually adds
 *
 * The stub self-validates five of the thirteen responses below — goals, upcoming sessions,
 * observations, indicators, proposals — and not the other eight, including `/athletes/me`,
 * `/programs/current` and all seven artefact reads.
 *
 * More to the point: **the real Rust backend self-validates none of them**, and this suite runs
 * against it unchanged, since both servers must satisfy the same contract.
 *
 *   CONFORMANCE_BASE_URL=http://127.0.0.1:18080/api/v1 pnpm conformance
 *
 * The first run against the real backend found one: `POST /programs` took `blocks` as opaque JSON,
 * so `"progressionIntent": "linear"` — a bare string where the contract declares an object
 * `{ kind, ratePercent? }` — was accepted with a 201 and served back with a 200. Every programme
 * created through the real API was a body the client refuses at its own boundary (ADR-0031). It had
 * been invisible because the stub returns the correct object form and the backend's own tests seeded
 * the string form, so both sides passed while disagreeing with the contract and with each other.
 *
 * ## Why it checks RESPONSES rather than fixtures
 *
 * A response is what a client actually receives, so this catches a serialisation bug the same way it
 * catches a stale fixture — and it needs no access to either server's internals, which is what lets
 * one suite point at both.
 *
 * ## What a failure here means, and what it does not
 *
 * The schemas are generated from `spec/openapi.json` and are deliberately not `.strict()`: unknown
 * keys are stripped rather than rejected, so a server adding a field cannot break a client. A failure
 * is therefore always one of two real things — a required field missing, or a field of the wrong
 * type. Both are changes that reach an athlete as a blank screen.
 */

/** A collection endpoint returns an array; every element must satisfy the schema. */
interface Collection {
  readonly path: string
  readonly schema: ZodTypeAny
  readonly note: string
}

/**
 * A single-artefact endpoint. `204` is a legitimate answer for most of these — "you have no
 * programme yet" is the normal state for a newly-onboarded athlete (§3.2) — so an empty answer is
 * skipped rather than failed, and the skip is REPORTED.
 */
interface Single {
  readonly path: string
  readonly schema: ZodTypeAny
  readonly note: string
}

const COLLECTIONS: readonly Collection[] = [
  { path: '/goals', schema: GoalSchema, note: 'what the athlete said they are training for' },
  {
    path: '/sessions/upcoming',
    schema: PrescribedSessionSchema,
    note: 'the sessions the plan asks for, screening verdict included (ADR-0021)',
  },
  {
    path: '/proposals',
    schema: ProposalSchema,
    note: 'the drift that started all this — `proposedBy` became required and a fixture did not follow',
  },
  { path: '/outcomes', schema: DecisionOutcomeSchema, note: 'verdicts rendered on proposals' },
  {
    path: '/indicators',
    schema: IndicatorSeriesSchema,
    note: 'derived on read, never stored (ADR-0006)',
  },
]

const SINGLES: readonly Single[] = [
  { path: '/athletes/me', schema: AthleteSchema, note: 'the tenant themselves (ADR-0001)' },
  { path: '/programs/current', schema: ProgramSchema, note: 'the programme and its current version' },
  { path: '/plans/current', schema: PlanSchema, note: 'the timeline' },
  { path: '/check-in-forms/current', schema: CheckInFormSchema, note: 'the check-in form' },
  { path: '/reports/current', schema: ReportSchema, note: 'the report canvas' },
  { path: '/dashboards/current', schema: DashboardSchema, note: 'the dashboard layout' },
  { path: '/nutrition-plans/current', schema: NutritionPlanSchema, note: 'the nutrition plan' },
  { path: '/workflows/current', schema: WorkflowSchema, note: 'the automation graph' },
]

/** Zod's issues, flattened into something a person can act on without opening the schema. */
const explain = (result: { readonly success: false; readonly error: { issues: readonly unknown[] } }) =>
  (result.error.issues as readonly { path: readonly (string | number)[]; message: string }[])
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')

beforeAll(async () => {
  await signIn()
})

describe('every response matches the shape this server publishes', () => {
  for (const { path, schema, note } of COLLECTIONS) {
    it(`${path} — ${note}`, async () => {
      const response = await request<readonly unknown[]>(path)

      expect(response.status, `${path} must answer 200 for a signed-in athlete`).toBe(200)
      expect(Array.isArray(response.body), `${path} returns a bare array, not an envelope`).toBe(true)

      const items = response.body as readonly unknown[]
      if (items.length === 0) {
        // Reported rather than passed silently. An empty collection satisfies every schema
        // vacuously, and a green tick on an unasked question is what this file exists to prevent.
        console.warn(`[shapes] ${path} was empty — nothing was actually validated`)
        return
      }

      items.forEach((item, index) => {
        const result = schema.safeParse(item)
        if (!result.success) {
          throw new Error(
            `${path}[${String(index)}] does not match its published schema:\n${explain(result as never)}\n\n` +
              `received: ${JSON.stringify(item)}`,
          )
        }
      })
    })
  }

  for (const { path, schema, note } of SINGLES) {
    it(`${path} — ${note}`, async () => {
      const response = await request(path)

      // 204 is a legitimate answer (§3.2), and 404 is the honest one for an athlete who does not
      // exist yet. Neither is a shape failure; both mean there was nothing to check.
      if (response.status === 204 || response.status === 404 || response.body === null) {
        console.warn(`[shapes] ${path} answered ${String(response.status)} — nothing to validate`)
        return
      }

      expect(response.status, `${path} answered unexpectedly`).toBe(200)

      const result = schema.safeParse(response.body)
      if (!result.success) {
        throw new Error(
          `${path} does not match its published schema:\n${explain(result as never)}\n\n` +
            `received: ${JSON.stringify(response.body)}`,
        )
      }
    })
  }
})
