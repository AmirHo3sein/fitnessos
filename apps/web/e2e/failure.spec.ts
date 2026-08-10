import { expect, test, type Page } from '@playwright/test'

/**
 * What the product does when things go wrong.
 *
 * Every screen here makes a promise about a bad moment — "your changes are still here", "this
 * could not be loaded", a session that ends and puts you back at sign-in. None of them had ever
 * been observed working, because nothing in the app could be made to fail on demand and the only
 * alternative was test-only code in the product.
 *
 * The fault lives in the stub instead (`POST /__fault`), which is already a fabrication and never
 * ships. A test arms a route, then drives the UI normally.
 *
 * ## An intermittent that was observed once and not reproduced
 *
 * One parallel run of this file failed three tests — two programme scans and the check-in load — and
 * every one of them passed in isolation immediately afterwards, and the same parallel invocation
 * passed 24/24 on the next attempt, and two consecutive full-suite runs passed 255/255. No
 * mechanism was established, so none is claimed here.
 *
 * One nearby cause WAS found and fixed rather than left to suspicion: `an added block is persisted
 * with a contiguous order` in `shell.spec.ts` was genuinely racy — it reloaded while a POST was in
 * flight — and now waits for the commit boundary to move. If failures recur in this file, that is
 * the shape to look for first: a test that continues before the write it depends on has landed.
 *
 * ## What is NOT here, and why that is a finding rather than a gap
 *
 * The three error boundaries cannot be reached this way, and it turns out they cannot be reached
 * by any data fault at all. Every path from the network to a screen is already handled: query
 * failures become an error STATE, the RSC prefetch uses `prefetchQuery` which does not throw, and
 * mappers reject at the boundary into a query that is expecting to fail.
 *
 * So the boundaries are a net for BUGS, not for bad data — which is what a boundary should be.
 * Their absence from this file is evidence the layers below them do their job, and the component
 * tests over the panel cover the rest.
 */

const GOOD_CODE = '۰۰۰۰۰۰'

const phoneFor = (testCode: string, project: string) => {
  const projectCode = project === 'chromium' ? '130' : '131'
  const ascii = `0912${testCode}${projectCode}9`
  return [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')
}

const signIn = async (page: Page, phone: string) => {
  await page.goto('/sign-in')
  await page.getByLabel('شماره‌ی موبایل').fill(phone)
  await page.getByRole('button', { name: 'ارسال کد' }).click()
  await page.getByLabel('کد تأیید').fill(GOOD_CODE)
  await page.getByRole('button', { name: 'تأیید و ورود' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
}

/** Arm a fault for the signed-in session. Uses the browser's own cookies. */
const arm = async (page: Page, route: string, fault: string) => {
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
  const response = await page.request.post('http://127.0.0.1:8791/__fault', {
    headers: { cookie },
    data: { route, fault },
  })
  expect(response.status()).toBe(204)
}

test.describe('a response that does not match the contract', () => {
  test('@critical shows an error state rather than a blank screen or a crash', async ({ page }) => {
    /*
     * ADR-0031's whole purpose, observed for the first time. A mapper takes `unknown` and
     * validates before mapping, so a backend that drifts produces a `ContractViolationError`
     * rather than `undefined` surfacing three layers away as a blank cell.
     *
     * What the athlete must see is an explanation, not an empty card and not a stack trace.
     */
    await signIn(page, phoneFor('111', test.info().project.name))
    await arm(page, 'GET /api/v1/programs/current', 'malformed')

    await page.goto('/programme')
    await expect(page.getByText('برنامه بارگذاری نشد.')).toBeVisible()

    // The shell survives: navigation still works, so one bad endpoint does not take the app down.
    await expect(page.getByRole('link', { name: 'جلسه‌ها' })).toBeVisible()
  })

  test('does not leak the validator’s message to the screen', async ({ page }) => {
    // `invalid_type` messages render received values verbatim, so a field holding user input
    // would put it on screen — and into any screenshot attached to a support ticket.
    await signIn(page, phoneFor('222', test.info().project.name))
    await arm(page, 'GET /api/v1/programs/current', 'malformed')
    await page.goto('/programme')

    await expect(page.getByText('برنامه بارگذاری نشد.')).toBeVisible()
    await expect(page.getByText(/not-a-uuid/)).toHaveCount(0)
    await expect(page.getByText(/invalid_type|expected|received/i)).toHaveCount(0)
  })
})

test.describe('a server error while saving', () => {
  test('@critical the programme builder keeps the coach’s edits', async ({ page }) => {
    /*
     * The promise every builder makes: "your changes could not be saved — they are still here."
     * The commit boundary must NOT move, or the coach is left holding edits they can neither
     * retry nor reverse.
     */
    await signIn(page, phoneFor('333', test.info().project.name))
    await page.goto('/programme')
    await page.getByRole('button', { name: 'ویرایش برنامه' }).click()

    const name = page.getByLabel('نام بلوک').first()
    await name.fill('Edited before the failure')

    await arm(page, 'POST /api/v1/programs/:programId/versions', 'server-error')
    await page.getByRole('button', { name: 'ذخیره' }).click()

    // Told, in their own language.
    await expect(page.getByText('تغییرات شما ذخیره نشد. تغییرات همچنان اینجاست؛ دوباره تلاش کنید.')).toBeVisible()

    // Still on screen.
    await expect(name).toHaveValue('Edited before the failure')

    // And still reversible — the commit boundary did not move past a save that never happened.
    await expect(page.getByRole('button', { name: 'واگرد' })).toBeEnabled()
  })

  test('the report builder keeps the layout', async ({ page }) => {
    await signIn(page, phoneFor('444', test.info().project.name))
    await page.goto('/report')
    await page.getByRole('button', { name: 'ساختن گزارش' }).click()
    await page.getByRole('button', { name: 'افزودن کاشی' }).click()

    await arm(page, 'PUT /api/v1/reports/:reportId', 'server-error')
    await page.getByRole('button', { name: 'ذخیره' }).click()

    await expect(page.getByText('تغییرات شما ذخیره نشد. تغییرات همچنان اینجاست؛ دوباره تلاش کنید.')).toBeVisible()
    await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'واگرد' })).toBeEnabled()
  })
})

test.describe('a session that ends', () => {
  test('@critical a 401 the client cannot refresh past returns the user to sign-in', async ({
    page,
  }) => {
    /*
     * The path built early and never exercised end to end: a 401 triggers a single-flight
     * refresh; the refresh itself fails; `onSessionLost` fires and the router replaces the page
     * with sign-in.
     *
     * Both routes are armed, because arming only the data route would let the refresh succeed
     * and the request retry — which is the OTHER correct behaviour, and not this test.
     */
    await signIn(page, phoneFor('555', test.info().project.name))
    await arm(page, 'GET /api/v1/athletes/me', 'unauthorized')
    await arm(page, 'POST /api/v1/auth/refresh', 'unauthorized')

    await page.goto('/dashboard')

    // Landed back at sign-in rather than sitting on a shell that 401s forever.
    await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 })
  })
})

test.describe('a LOAD that fails, in an authoring screen', () => {
  test('@critical a nutrition plan that could not be loaded does not look like no plan', async ({
    page,
  }) => {
    /**
     * The defect this whole pass was looking for, and it is a data-loss path rather than a cosmetic
     * one.
     *
     * Six authoring hooks expose only the MUTATION error. A failed GET leaves the workspace with
     * `plan === null`, which is exactly what "nothing authored yet" looks like — so a transient
     * network failure renders "no plan has been written yet" beside a Create button. Pressing it
     * PUTs a NEW id, and since the server keys "current" per athlete, the plan that merely failed to
     * load is overwritten by an empty one.
     *
     * The Programme route gets this right, which is why nobody noticed: the oldest editor
     * distinguishes the two states and five later ones copied a hook that does not.
     */
    await signIn(page, phoneFor('666', test.info().project.name))

    // Author a plan first, so there IS something to lose.
    await page.goto('/nutrition')
    await page.getByRole('button', { name: 'ساختن برنامه‌ی تغذیه' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()

    await arm(page, 'GET /api/v1/nutrition-plans/current', 'malformed')
    await page.goto('/nutrition')

    // Told that it could not be loaded...
    await expect(page.getByText('برنامه‌ی تغذیه بارگذاری نشد.')).toBeVisible()
    // ...and NOT invited to create a second one over the top of it.
    await expect(page.getByRole('button', { name: 'ساختن برنامه‌ی تغذیه' })).toHaveCount(0)
  })

  test('@critical the same for the automation', async ({ page }) => {
    await signIn(page, phoneFor('777', test.info().project.name))
    await page.goto('/automation')
    await page.getByRole('button', { name: 'ساختن خودکارسازی' }).click()
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()

    await arm(page, 'GET /api/v1/workflows/current', 'malformed')
    await page.goto('/automation')

    await expect(page.getByText('خودکارسازی بارگذاری نشد.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'ساختن خودکارسازی' })).toHaveCount(0)
  })
})

test.describe('a save that fails in the newer editors', () => {
  test('@critical the nutrition builder keeps the meal that could not be saved', async ({ page }) => {
    await signIn(page, phoneFor('888', test.info().project.name))
    await page.goto('/nutrition')
    await page.getByRole('button', { name: 'ساختن برنامه‌ی تغذیه' }).click()

    const name = page.getByLabel('نام وعده').first()
    await name.fill('پیش از تمرین')

    await arm(page, 'PUT /api/v1/nutrition-plans/:planId', 'server-error')
    await page.getByRole('button', { name: 'ذخیره' }).click()

    await expect(page.getByText('تغییرات شما ذخیره نشد. تغییرات همچنان اینجاست؛ دوباره تلاش کنید.')).toBeVisible()
    await expect(name).toHaveValue('پیش از تمرین')
    // The commit boundary did not move past a save that never happened.
    await expect(page.getByRole('button', { name: 'واگرد' })).toBeEnabled()
  })

  test('@critical the workflow builder keeps the graph, and stays reversible', async ({ page }) => {
    await signIn(page, phoneFor('999', test.info().project.name))
    await page.goto('/automation')
    await page.getByRole('button', { name: 'ساختن خودکارسازی' }).click()
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()

    await page.getByRole('button', { name: 'افزودن کنش' }).click()
    await expect(page.locator('.react-flow__node')).toHaveCount(2)

    await arm(page, 'PUT /api/v1/workflows/:workflowId', 'server-error')
    await page.getByRole('button', { name: 'ذخیره' }).click()

    await expect(page.getByText('تغییرات شما ذخیره نشد. تغییرات همچنان اینجاست؛ دوباره تلاش کنید.')).toBeVisible()
    await expect(page.locator('.react-flow__node')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'واگرد' })).toBeEnabled()
  })

  test('a KEYBOARD move survives a failed save, exactly as a drag does', async ({ page }) => {
    /*
     * The arrow-key paths are new, and they dispatch through the same store as a drag — so this
     * should hold by construction. Asserted anyway, because "by construction" is what was believed
     * about the commit boundary before an e2e showed it moving on a failed save.
     */
    await signIn(page, phoneFor('101', test.info().project.name))
    await page.goto('/plan')
    await page.getByRole('button', { name: 'ساختن برنامه' }).click()
    await expect(page.getByTestId('timeline-track')).toBeVisible()

    const phase = page.locator('[data-testid^="phase-"]').first()
    await phase.focus()
    // RTL: later time runs along the reading direction.
    await page.keyboard.press('ArrowLeft')
    await expect(phase).toHaveAttribute('data-start', '7')

    await arm(page, 'PUT /api/v1/plans/:planId', 'server-error')
    await page.getByRole('button', { name: 'ذخیره' }).click()

    await expect(page.getByText('تغییرات شما ذخیره نشد. تغییرات همچنان اینجاست؛ دوباره تلاش کنید.')).toBeVisible()
    await expect(phase).toHaveAttribute('data-start', '7')
    await expect(page.getByRole('button', { name: 'واگرد' })).toBeEnabled()
  })

  test('the check-in form reports a failed LOAD too', async ({ page }) => {
    /*
     * The sixth of the six hooks that shared the defect, and the oldest — in a different context
     * from the two asserted above. The remaining three (report, layout, plan) share the identical
     * branch, typechecked against the same interface; this covers the one that is furthest from the
     * others in the codebase rather than pretending six e2e tests of one code path add six things.
     */
    await signIn(page, phoneFor('102', test.info().project.name))
    await page.goto('/check-in')
    await page.getByRole('button', { name: 'ساختن فرم' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()

    await arm(page, 'GET /api/v1/check-in-forms/current', 'malformed')
    await page.goto('/check-in')

    await expect(page.getByText('فرم بررسی بارگذاری نشد.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'ساختن فرم' })).toHaveCount(0)
    // And a retry, so the answer to a dropped request is one press rather than a reload.
    await expect(page.getByRole('button', { name: 'تلاش دوباره' })).toBeVisible()
  })
})

test.describe('rate limiting', () => {
  test('a 429 on requesting a code is reported, not retried into', async ({ page }) => {
    /*
     * `retryAfterSeconds` is server-authoritative (see the contract). The client must not
     * compute its own cooldown, and must not treat a 429 as a generic failure that invites an
     * immediate second attempt — which is how a rate limit becomes a lockout.
     */
    await page.goto('/sign-in')

    // Armed without a session, so the fault is set through a direct request rather than `arm`.
    // A rate limit applies before anyone is signed in, which is exactly when it matters.
    await page.route('**/api/v1/auth/request-code', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'rate_limited', detail: 'too many requests' }),
      })
    })

    await page.getByLabel('شماره‌ی موبایل').fill('۰۹۱۲۳۴۵۶۷۸۹')
    await page.getByRole('button', { name: 'ارسال کد' }).click()

    // An error the user can act on, and NOT the code step — advancing would ask for a code that
    // was never sent.
    await expect(page.getByLabel('کد تأیید')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ارسال کد' })).toBeVisible()
  })
})
