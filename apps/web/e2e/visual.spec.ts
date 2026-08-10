import { expect, test, type Page } from '@playwright/test'

/**
 * Visual regression — the class of defect nothing else in this suite can see.
 *
 * ## Why this exists
 *
 * `globals.css` pointed Tailwind at two packages while the codebase had five. Every class used
 * only inside a graduated `ctx-*` package was absent from the built stylesheet, for three
 * packages at once. The Report Builder's canvas is `h-[520px]`; that class existed nowhere else,
 * so it laid out TWO PIXELS TALL — and 158 end-to-end tests, a WCAG audit and a full gate all
 * passed, because assertions read the DOM and axe does not measure layout.
 *
 * It was found by accident, debugging something else. That is the argument for these tests: a
 * stylesheet can lose an entire package and every other signal stays green.
 *
 * ## Baselines are per platform, and that is not a flaw to work around
 *
 * Font rasterisation and subpixel antialiasing differ between macOS and the Linux container CI
 * runs. Playwright names snapshots with the platform, so a baseline committed from a laptop is
 * simply not consulted on CI, which generates its own on first run.
 *
 * These live in the FULL tier rather than the critical one for the same reason. A visual diff is
 * a prompt to look, not proof of a defect, and blocking every PR on one is how a team learns to
 * pass `--update-snapshots` without reading the diff.
 *
 * ## Determinism
 *
 * Two sources of churn are dealt with explicitly rather than by loosening the threshold, because
 * a threshold loose enough to absorb a changing date is loose enough to absorb a layout bug:
 *
 *   animations   disabled outright — a transition mid-capture is a different image each run
 *   dates        masked. The dashboard renders "measured 3 days ago" and "12 days overdue" from
 *                today's date, so an unmasked baseline would fail every morning
 */

const GOOD_CODE = '۰۰۰۰۰۰'

/** Per project, because both write and they share one stub process. */
const phoneFor = (testCode: string, project: string) => {
  const projectCode = project === 'chromium' ? '120' : '121'
  const ascii = `0912${testCode}${projectCode}9`
  return [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')
}

/**
 * Freeze anything that moves on its own.
 *
 * `addInitScript` so it applies before first paint — a stylesheet injected after load would let
 * an entrance animation run and be captured mid-flight.
 */
const settle = async (page: Page) => {
  await page.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }`
    document.addEventListener('DOMContentLoaded', () => document.head.append(style))
  })
}

const signIn = async (page: Page, phone: string) => {
  await page.goto('/sign-in')
  await page.getByLabel('شماره‌ی موبایل').fill(phone)
  await page.getByRole('button', { name: 'ارسال کد' }).click()
  await page.getByLabel('کد تأیید').fill(GOOD_CODE)
  await page.getByRole('button', { name: 'تأیید و ورود' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
}

/**
 * Elements whose text is derived from today's date.
 *
 * Masked rather than frozen with a fake clock: the dates come from the SERVER render, so a
 * browser-side clock override would not reach them, and the honest alternative — a stub that
 * accepts a clock — is machinery for a problem a rectangle solves.
 */
const dateMasks = (page: Page) => [
  page.locator('.text-warning-fg'),
  page.getByText(/روز گذشته/),
  page.getByText(/اندازه‌گیری/),
]

const shot = async (page: Page, name: string, masks: ReturnType<typeof dateMasks> = []) => {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    mask: masks,
    // Tight. Anything looser starts absorbing the layout differences these exist to catch;
    // this covers antialiasing on a glyph edge and nothing more.
    maxDiffPixelRatio: 0.01,
    animations: 'disabled',
  })
}

test.describe('unauthenticated screens', () => {
  test.beforeEach(async ({ page }) => {
    await settle(page)
  })

  test('the public page', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await shot(page, 'public')
  })

  test('sign-in, both steps', async ({ page }) => {
    await page.goto('/sign-in')
    await shot(page, 'sign-in-phone')

    await page.getByLabel('شماره‌ی موبایل').fill('۰۹۱۲۳۴۵۶۷۸۹')
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await expect(page.getByLabel('کد تأیید')).toBeVisible()
    await shot(page, 'sign-in-code')
  })

  test('the 404', async ({ page }) => {
    await page.goto('/nope-does-not-exist')
    await expect(page.getByText('چنین صفحه‌ای وجود ندارد')).toBeVisible()
    await shot(page, 'not-found')
  })

  test('English, so the LTR layout is covered too', async ({ page }) => {
    // Direction changes computed layout, and a rule that only holds in one direction is a bug
    // that reaches half the users.
    await page.goto('/en')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await shot(page, 'public-en')
  })
})

test.describe('the authenticated shell', () => {
  test.beforeEach(async ({ page }) => {
    await settle(page)
  })

  test('the dashboard', async ({ page }) => {
    await signIn(page, phoneFor('111', test.info().project.name))
    await expect(page).toHaveURL(/\/dashboard/)
    await shot(page, 'dashboard', dateMasks(page))
  })

  test('the programme, read and in the builder', async ({ page }) => {
    await signIn(page, phoneFor('222', test.info().project.name))
    await page.goto('/programme')
    await expect(page.locator('ol li').first()).toBeVisible()
    await shot(page, 'programme-read')

    await page.getByRole('button', { name: 'ویرایش برنامه' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()
    await shot(page, 'programme-builder')
  })

  test('sessions and the logger', async ({ page }) => {
    await signIn(page, phoneFor('333', test.info().project.name))
    await page.goto('/sessions')
    await shot(page, 'sessions')

    await page.getByRole('button', { name: 'ثبت این جلسه' }).first().click()
    await expect(page.getByRole('button', { name: 'ثبت جلسه' })).toBeVisible()
    await shot(page, 'session-logger')
  })
})

test.describe('the editors', () => {
  test.beforeEach(async ({ page }) => {
    await settle(page)
  })

  test('the check-in form, empty and in the builder', async ({ page }) => {
    await signIn(page, phoneFor('444', test.info().project.name))
    await page.goto('/check-in')
    await expect(page.getByText('هنوز فرمی ساخته نشده')).toBeVisible()
    await shot(page, 'check-in-empty')

    await page.getByRole('button', { name: 'ساختن فرم' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()
    await shot(page, 'check-in-builder')
  })

  test('the report, empty and on the canvas', async ({ page }) => {
    /*
     * The canvas is the reason this file exists. Its height comes from a class used nowhere else
     * in the codebase, so it is exactly the shape of thing a missing stylesheet source drops —
     * and a screenshot is the only assertion here that would have noticed.
     */
    await signIn(page, phoneFor('555', test.info().project.name))
    await page.goto('/report')
    await expect(page.getByText('هنوز گزارشی ساخته نشده')).toBeVisible()
    await shot(page, 'report-empty')

    await page.getByRole('button', { name: 'ساختن گزارش' }).click()
    await expect(page.getByTestId('report-canvas')).toBeVisible()
    await shot(page, 'report-builder')
  })

  test('the nutrition plan, empty and with a meal open', async ({ page }) => {
    // The only builder with a nested list, so it is the only one where a stylesheet or spacing
    // regression can misalign one level against the other while both still read as present.
    await signIn(page, phoneFor('777', test.info().project.name))
    await page.goto('/nutrition')
    await expect(page.getByText('هنوز برنامه‌ی تغذیه‌ای ساخته نشده است.')).toBeVisible()
    await shot(page, 'nutrition-empty')

    await page.getByRole('button', { name: 'ساختن برنامه‌ی تغذیه' }).click()
    await page.getByRole('button', { name: 'افزودن خوراک' }).first().click()
    await expect(page.getByLabel('خوراک', { exact: true })).toHaveCount(1)
    await shot(page, 'nutrition-builder')
  })

  test('the report canvas has real height', async ({ page }) => {
    /**
     * The regression that started this, pinned as a measurement rather than an image.
     *
     * A screenshot would catch it, and a number says WHY it failed. When the stylesheet lost
     * three packages, this box was 2 pixels tall — so the assertion is deliberately crude: not
     * "matches the baseline", but "has the height its class asks for".
     */
    await signIn(page, phoneFor('666', test.info().project.name))
    await page.goto('/report')
    await page.getByRole('button', { name: 'ساختن گزارش' }).click()

    const box = await page.getByTestId('report-canvas').boundingBox()
    expect(box?.height).toBeGreaterThan(400)
  })
})
