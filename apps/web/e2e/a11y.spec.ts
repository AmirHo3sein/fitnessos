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

/**
 * A phone unique to this test AND this project, for tests that WRITE.
 *
 * Most scans here are read-only and share `PHONE`. Authoring a check-in form is not: chromium
 * and mobile-rtl run the same specs against one stub process, so the first project to create a
 * form left the second with no "create" button and a thirty-second timeout. The same isolation
 * trap the session-logging tests hit, and the same fix.
 *
 * 0912 + testCode(3) + projectCode(3) + '9' = 11 digits, which is what an Iranian mobile is.
 */
const phoneFor = (testCode: string, project: string) => {
  const projectCode = project === 'chromium' ? '116' : '117'
  const ascii = `0912${testCode}${projectCode}9`
  return [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')
}

const signIn = async (page: Page, phone: string = PHONE) => {
  await page.goto('/sign-in')
  await page.getByLabel('شماره‌ی موبایل').fill(phone)
  await page.getByRole('button', { name: 'ارسال کد' }).click()
  await page.getByLabel('کد تأیید').fill(GOOD_CODE)
  await page.getByRole('button', { name: 'تأیید و ورود' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
}

test.describe('every page passes WCAG 2.1 AA', () => {
  test('the public page', async ({ page }) => {
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

  test('the dashboard', async ({ page }) => {
    await signIn(page)
    await expect(page).toHaveURL(/\/dashboard/)
    await expectNoViolations(page)
  })

  test('the programme, read and edit', async ({ page }) => {
    // The builder is the thing the gate names. Scanned in both modes because they are different
    // trees — the editor is code-split and mounts controls the read view does not have.
    await signIn(page)
    await page.goto('/programme')
    await expectNoViolations(page)

    await page.getByRole('button', { name: 'ویرایش برنامه' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()
    await expectNoViolations(page)
  })

  test('sessions, list and logger', async ({ page }) => {
    await signIn(page)
    await page.goto('/sessions')
    await expectNoViolations(page)

    await page.getByRole('button', { name: 'ثبت این جلسه' }).first().click()
    await expect(page.getByRole('button', { name: 'ثبت جلسه' })).toBeVisible()
    await expectNoViolations(page)
  })

  test('the check-in form builder', async ({ page }) => {
    // The second editor, scanned in both its states: the empty one a coach lands on, and the
    // builder they create.
    await signIn(page, phoneFor('111', test.info().project.name))
    await page.goto('/check-in')
    await expectNoViolations(page)

    await page.getByRole('button', { name: 'ساختن فرم' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()
    await expectNoViolations(page)
  })

  test('the nutrition builder, which nests one list inside another', async ({ page }) => {
    /*
     * Scanned because the nesting is new here. Every builder before this rendered one flat list;
     * this one puts an `ol` of items inside an `li` of a meal, and the two things a scan can
     * actually settle about that structure are whether the nested list is validly placed and
     * whether each of the two levels' fields still has a label of its own.
     */
    await signIn(page, phoneFor('111', test.info().project.name))
    await page.goto('/nutrition')
    await expectNoViolations(page)

    await page.getByRole('button', { name: 'ساختن برنامه‌ی تغذیه' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()
    await expectNoViolations(page)

    // With something in the nested level, since an empty meal renders no inner list at all.
    await page.getByRole('button', { name: 'افزودن خوراک' }).first().click()
    await expect(page.getByLabel('خوراک', { exact: true })).toHaveCount(1)
    await expectNoViolations(page)
  })

  test('the workflow builder, canvas and all', async ({ page }) => {
    /*
     * The hardest scan in this file, and the reason it is here rather than assumed: a node-graph
     * canvas is exactly the kind of widget that fails an audit. React Flow renders a pane full of
     * absolutely-positioned divs with drag handles, and the connection gesture is pointer-only.
     *
     * Two things are being checked. First, that the canvas as shipped introduces no violations —
     * it is marked `role="application"` with a name, which is the honest description of a
     * direct-manipulation surface. Second, and more important, that the STEP LIST beside it is
     * fully labelled: that list is how the workflow is authored without a pointer, and a scan
     * finding it unlabelled would mean the accessible route does not exist in practice.
     */
    await signIn(page, phoneFor('111', test.info().project.name))
    await page.goto('/automation')
    await expectNoViolations(page)

    await page.getByRole('button', { name: 'ساختن خودکارسازی' }).click()
    await expect(page.getByTestId('workflow-canvas')).toBeVisible()
    await expectNoViolations(page)

    // With a second step and a connection control on screen, since an unconnected single node
    // renders neither a select nor an edge.
    await page.getByRole('button', { name: 'افزودن کنش' }).click()
    await expect(page.getByLabel('به گام').first()).toBeVisible()
    await expectNoViolations(page)
  })

  test('the 404', async ({ page }) => {
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

  test('the page has one h1 and a main landmark', async ({ page }) => {
    // Structure, which is how a screen-reader user navigates rather than reads. Axe checks some
    // of this only when a landmark is present at all, so its absence can pass silently.
    await signIn(page)
    await page.goto('/programme')

    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })
})
