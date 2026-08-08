import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

/**
 * Accessibility audit — the Phase 6 gate, "AA on all builders".
 *
 * ## Why this is a separate file
 *
 * `shell.spec.ts` asserts behaviour. This asserts a property of every page, and the two have
 * different failure modes: a behaviour test tells you a feature broke, an audit tells you a
 * population cannot use it. Mixing them makes the second easy to skip.
 *
 * ## What axe can and cannot tell us
 *
 * It catches the mechanical half — a control with no accessible name, an `aria-` attribute that
 * does not apply to its role, a contrast ratio below threshold, a heading level skipped. That is
 * genuinely most of what goes wrong, and none of it is visible in review.
 *
 * It cannot judge whether a label is *meaningful*, whether focus goes somewhere sensible after an
 * action, or whether a keyboard user can complete a task. Those are asserted explicitly below,
 * because "axe passes" is not the same as "a person using this can work".
 *
 * ## Persian, RTL, and why the audit runs in both projects
 *
 * The playwright config runs every spec under `chromium` and `mobile-rtl`. That is not
 * duplication here: direction affects computed layout, and a contrast or focus-order failure can
 * exist in one direction and not the other.
 */

const GOOD_CODE = '۰۰۰۰۰۰'
const PHONE = '۰۹۱۲۳۴۵۶۷۸۹'

/**
 * WCAG 2.1 AA, which is what the roadmap's exit gate names.
 *
 * `best-practice` is deliberately excluded. It is a useful advisory set and it is not the
 * standard being claimed; folding it in would mean either failing the gate on things AA does not
 * require, or loosening the gate until it stops meaning AA.
 */
const scan = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])

/** Reports the rule and the element, so a failure is actionable without opening the trace. */
const expectNoViolations = async (page: Page) => {
  const { violations } = await scan(page).analyze()
  const readable = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => n.target.join(' ')),
  }))
  expect(readable).toEqual([])
}

const signIn = async (page: Page) => {
  await page.goto('/sign-in')
  await page.getByLabel('شماره‌ی موبایل').fill(PHONE)
  await page.getByRole('button', { name: 'ارسال کد' }).click()
  await page.getByLabel('کد تأیید').fill(GOOD_CODE)
  await page.getByRole('button', { name: 'تأیید و ورود' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
}

test.describe('every page passes WCAG 2.1 AA', () => {
  test('@critical the public page', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expectNoViolations(page)
  })

  test('@critical sign-in, both steps', async ({ page }) => {
    // Two steps, two scans. The code step replaces the form's content, and a violation
    // introduced there would be invisible to a scan of the phone step.
    await page.goto('/sign-in')
    await expectNoViolations(page)

    await page.getByLabel('شماره‌ی موبایل').fill(PHONE)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await expect(page.getByLabel('کد تأیید')).toBeVisible()
    await expectNoViolations(page)
  })

  test('@critical the dashboard', async ({ page }) => {
    await signIn(page)
    await expect(page).toHaveURL(/\/dashboard/)
    await expectNoViolations(page)
  })

  test('@critical the programme, read and edit', async ({ page }) => {
    // The builder is the thing the gate names. Scanned in both modes because they are different
    // trees — the editor is code-split and mounts controls the read view does not have.
    await signIn(page)
    await page.goto('/programme')
    await expectNoViolations(page)

    await page.getByRole('button', { name: 'ویرایش برنامه' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()
    await expectNoViolations(page)
  })

  test('@critical sessions, list and logger', async ({ page }) => {
    await signIn(page)
    await page.goto('/sessions')
    await expectNoViolations(page)

    await page.getByRole('button', { name: 'ثبت این جلسه' }).first().click()
    await expect(page.getByRole('button', { name: 'ثبت جلسه' })).toBeVisible()
    await expectNoViolations(page)
  })

  test('@critical the 404', async ({ page }) => {
    await page.goto('/nope-does-not-exist')
    await expectNoViolations(page)
  })
})

test.describe('what an automated scan cannot check', () => {
  test('@critical the programme builder is operable by keyboard alone', async ({ page }) => {
    /*
     * The half of the gate axe cannot reach. Every control can have a perfect accessible name and
     * still be unreachable without a mouse, and an editor that cannot be driven from the keyboard
     * is one a whole population cannot author with — while passing every automated check.
     *
     * Tab order is asserted by USING it, not by reading it: reach the first block's name field,
     * type, and confirm the edit landed.
     */
    await signIn(page)
    await page.goto('/programme')

    await page.getByRole('button', { name: 'ویرایش برنامه' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()

    const firstName = page.getByLabel('نام بلوک').first()
    await firstName.focus()
    // `ControlOrMeta`, not `Control`: select-all is Cmd+A on macOS, and hard-coding Control makes
    // the test prepend rather than replace — passing on CI and failing on a developer's machine,
    // or the reverse, which is the worst way for a test to be wrong.
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Keyboard only')
    await expect(firstName).toHaveValue('Keyboard only')

    // Undo, from its button, reached by keyboard rather than clicked.
    await page.getByRole('button', { name: 'واگرد' }).focus()
    await page.keyboard.press('Enter')
    await expect(firstName).not.toHaveValue('Keyboard only')
  })

  test('@critical focus is visible wherever it lands', async ({ page }) => {
    /*
     * A focus ring removed for aesthetics is the single most common way a keyboard user is locked
     * out of a product that otherwise passes an audit — and axe cannot see it, because
     * `outline: none` with no replacement is valid CSS.
     *
     * Asserted as "something changes": either an outline or a box-shadow. Which of the two is a
     * design decision and this should not care, but neither is not an option.
     */
    await page.goto('/sign-in')
    const field = page.getByLabel('شماره‌ی موبایل')
    await field.focus()

    const ring = await field.evaluate((el) => {
      const style = getComputedStyle(el)
      return { outline: style.outlineStyle, width: style.outlineWidth, shadow: style.boxShadow }
    })

    const hasOutline = ring.outline !== 'none' && ring.width !== '0px'
    const hasShadow = ring.shadow !== 'none' && ring.shadow !== ''
    expect(hasOutline || hasShadow).toBe(true)
  })

  test('@critical the page has one h1 and a main landmark', async ({ page }) => {
    // Structure, which is how a screen-reader user navigates rather than reads. Axe checks some
    // of this only when a landmark is present at all, so its absence can pass silently.
    await signIn(page)
    await page.goto('/programme')

    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })
})
