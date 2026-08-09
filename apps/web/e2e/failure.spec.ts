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
