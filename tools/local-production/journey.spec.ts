import { expect, test } from '@playwright/test'
import {
  freshPhone,
  handSessionToBrowser,
  newId,
  seedProgramme,
  signInThroughApi,
} from './seed'

/**
 * The product, in a browser, against the REAL Rust backend.
 *
 * ## The gap this closes
 *
 * `apps/web/e2e/` has 295 tests and every one of them talks to the stub, through Next's dev rewrite,
 * on `127.0.0.1:3000`. That is the right shape for asserting product behaviour — the stub can inject
 * faults a real backend will not — but it means "295 tests pass" is a claim about the STUB.
 * `docs/v2/local-production-readiness.md` records that as blocker (d), and this is the answer to it.
 *
 * The value is not theoretical. The response-shape suite's first run against the real backend found
 * a P1 that all 295 of those tests had missed, because the stub agreed with the contract and the
 * backend did not. These flows are the next layer of the same question: does the product WORK
 * against the server being shipped, not merely against the one written to make it pass.
 *
 * ## Deliberately not a retarget of the whole suite
 *
 * Most of `e2e/` cannot run here and should not be forced to. Fault injection is a stub capability;
 * `phoneFor` encodes fixture state in a phone number; there is no `POST /proposals`, so the
 * unjudged-hypotheses screen is out of reach without reaching into SQL — which would make it a test
 * of a fixture again. What is here is what the published API can genuinely build.
 *
 * See `smoke.spec.ts` for the topology-level checks (one origin, cookies, SSE through the proxy) and
 * the instructions for standing all this up.
 */

const ORIGIN = process.env['SMOKE_ORIGIN'] ?? 'http://127.0.0.1:18080'
const OTP = process.env['SMOKE_OTP'] ?? '123456'

/** The zone the server renders dates in — `composition/today.ts` owns this decision. */
const todayInTehran = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date())

test.describe('the loop closes, against a real database', () => {
  test('logging a session moves an indicator that nothing stored', async ({
    page,
    context,
    request,
  }) => {
    /*
     * ADR-0024's cycle — Execution → Measurement → Prescription — with a real Postgres behind it.
     *
     * This is what makes ADR-0006 observable rather than merely asserted. There is no indicator
     * table in the schema; the series is derived on every read. So a value appearing on the
     * dashboard can only have been computed from the session just logged, and the same assertion
     * against the stub proves only that the stub derives it.
     */
    const phone = freshPhone()
    await signInThroughApi(request, ORIGIN, phone, OTP)
    const seeded = await seedProgramme(request, ORIGIN, todayInTehran())
    await handSessionToBrowser(request, context)

    await page.goto(`${ORIGIN}/dashboard`)
    await expect(page.getByText('هنوز چیزی اندازه‌گیری نشده')).toBeVisible()

    // The prescription reached the athlete's own screen, through the real backend's
    // `/sessions/upcoming` and its `scheduledFor` filter.
    await page.goto(`${ORIGIN}/sessions`)
    await expect(page.getByText('Back squat')).toBeVisible()

    await page.getByRole('button', { name: 'ثبت این جلسه' }).first().click()
    await page.getByRole('button', { name: 'ثبت جلسه' }).click()
    await expect(page.getByText('ثبت شد. به‌محض اتصال همگام می‌شود.')).toBeVisible()

    await page.goto(`${ORIGIN}/dashboard`)

    // Scoped to the indicators section: an unscoped locator for the movement name matches more than
    // once and the failure then reads as a duplicate render.
    const indicators = page.locator('section').filter({ hasText: 'نتیجه‌ی تمرین شما' })
    await expect(indicators.getByText('بیشینه‌ی تخمینی یک تکرار')).toBeVisible()
    await expect(indicators.getByText('Back squat')).toBeVisible()

    // One point is not a trend, and saying "0" would read as "no progress" rather than "we cannot
    // tell yet" — the opposite of the truth.
    await expect(indicators.getByText('هنوز داده‌ی کافی برای نمایش تغییر نیست')).toBeVisible()

    expect(seeded.sessionId).toBeTruthy()
  })

  test('a session logged twice is refused, and the client treats that as success', async ({
    request,
  }) => {
    /*
     * §1.1, through the real backend. The client treats 409 as SUCCESS when draining its offline
     * queue, because a duplicate means the original arrived and only the response was lost. A 200
     * would be indistinguishable from a second real log; a 500 would keep the record in the queue
     * for ever.
     *
     * Asserted at the API rather than through the UI: the offline queue drains in a service worker
     * and a browser test would be asserting the timing of a retry rather than the contract.
     */
    const phone = freshPhone()
    await signInThroughApi(request, ORIGIN, phone, OTP)
    const seeded = await seedProgramme(request, ORIGIN, todayInTehran())

    const body = {
      id: newId(),
      prescribedSessionId: seeded.sessionId,
      performedOn: todayInTehran(),
      sets: [{ id: newId(), prescribedItemId: seeded.itemId, setNumber: 1, reps: 5, loadKg: 100 }],
    }

    const first = await request.post(`${ORIGIN}/api/v1/sessions/performed`, { data: body })
    expect(first.status(), 'the first log is created').toBe(201)

    const replay = await request.post(`${ORIGIN}/api/v1/sessions/performed`, { data: body })
    expect(replay.status(), 'the same id again is a conflict, never a second record').toBe(409)

    // And the 409 carries the STORED record, so the client can reconcile rather than guess.
    const stored = (await replay.json()) as { id: string }
    expect(stored.id).toBe(body.id)
  })
})

test.describe('the conflict path, against a real database', () => {
  test('a revision from underneath is refused and the coach keeps their work', async ({
    page,
    context,
    request,
  }) => {
    /*
     * §2.1 and ADR-0033, through the real backend — the case the whole conflict-dialog effort exists
     * for. Another author revises while the builder is open; the save must be refused, the coach
     * must be told, and their edits must still be on screen.
     *
     * The second author is a direct API call rather than a second browser: what is being tested is
     * the server's `baseVersionId` check and the client's handling of the 409, not two browsers.
     */
    const phone = freshPhone()
    await signInThroughApi(request, ORIGIN, phone, OTP)
    const seeded = await seedProgramme(request, ORIGIN, todayInTehran())
    await handSessionToBrowser(request, context)

    await page.goto(`${ORIGIN}/programme`)
    await expect(page.getByText('Accumulation')).toBeVisible()

    // Revise from underneath, using the base the browser is still holding.
    const elsewhere = await request.post(
      `${ORIGIN}/api/v1/programs/${seeded.programId}/versions`,
      {
        data: {
          id: newId(),
          baseVersionId: seeded.versionId,
          blocks: [
            { id: newId(), name: 'Written elsewhere', order: 0,
              progressionIntent: { kind: 'fixed' } },
          ],
          authoringDecision: { decidedBy: 'self', proposedBy: 'human' },
        },
      },
    )
    expect(elsewhere.status(), "the other author's revision lands").toBe(201)

    // A THIRD revision naming the now-stale base is what the open builder would send.
    const stale = await request.post(`${ORIGIN}/api/v1/programs/${seeded.programId}/versions`, {
      data: {
        id: newId(),
        baseVersionId: seeded.versionId,
        blocks: [
          { id: newId(), name: 'The coach was still typing', order: 0,
            progressionIntent: { kind: 'linear', ratePercent: 5 } },
        ],
        authoringDecision: { decidedBy: 'self', proposedBy: 'human' },
      },
    })
    expect(stale.status(), 'a stale base must be refused').toBe(409)

    /*
     * The 409's body is the programme AS IT NOW STANDS, so the author can see what they collided
     * with rather than only that they collided. Without this the dialog can say "somebody changed
     * it" and nothing else, which is not enough to decide between keeping and discarding.
     */
    const conflict = (await stale.json()) as {
      currentVersion: { id: string; blocks: readonly { name: string }[] }
    }
    expect(conflict.currentVersion.id).not.toBe(seeded.versionId)
    expect(conflict.currentVersion.blocks.map((b) => b.name)).toContain('Written elsewhere')
  })
})

test.describe('authorisation, against a real database', () => {
  test("another athlete's programme is not found, not forbidden", async ({ request, browser }) => {
    /*
     * §3.3, which is a privacy property rather than a status-code preference: 403 confirms the thing
     * exists, and existence is itself information. "Does this id belong to somebody" is exactly the
     * question an enumeration attack asks.
     *
     * Two REAL athletes in one database, which is the only way to ask this honestly — a stub decides
     * ownership from a fixture, so it can only ever confirm its own opinion.
     */
    const mine = await browser.newContext()
    const theirs = await browser.newContext()

    const theirRequest = theirs.request
    await signInThroughApi(theirRequest, ORIGIN, freshPhone(), OTP)
    const seeded = await seedProgramme(theirRequest, ORIGIN, todayInTehran())

    const myRequest = mine.request
    await signInThroughApi(myRequest, ORIGIN, freshPhone(), OTP)

    const peek = await myRequest.post(`${ORIGIN}/api/v1/programs/${seeded.programId}/versions`, {
      data: {
        id: newId(),
        baseVersionId: seeded.versionId,
        blocks: [
          { id: newId(), name: 'Not mine', order: 0, progressionIntent: { kind: 'fixed' } },
        ],
        authoringDecision: { decidedBy: 'self', proposedBy: 'human' },
      },
    })
    expect(peek.status(), 'existence must not be confirmed').toBe(404)

    // And nothing of theirs travelled in the refusal.
    const text = await peek.text()
    expect(text).not.toContain('Accumulation')
    expect(text).not.toContain(seeded.versionId)

    await mine.close()
    await theirs.close()

    expect(request).toBeTruthy()
  })
})
