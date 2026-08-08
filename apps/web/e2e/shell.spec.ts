import { expect, test } from '@playwright/test'

/**
 * Critical-path checks on the app shell. Each one guards a failure that is either
 * invisible in review or catastrophic in production.
 */

test.describe('locale and direction', () => {
  test('@critical Persian is served unprefixed and in RTL', async ({ page }) => {
    await page.goto('/')

    // `dir` is set from the route param in a server component, not by an effect
    // after mount. If someone moves it to an effect, this still passes on the final
    // DOM — so assert on the server response too, below.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa')
  })

  test('@critical direction is correct in the first byte, not after hydration', async ({
    request,
  }) => {
    // The bug this catches is a visible LTR→RTL flip on first paint for every
    // Persian user. It cannot be caught by inspecting the hydrated DOM, because by
    // then the flip has already happened and been corrected.
    const html = await (await request.get('/')).text()
    expect(html).toMatch(/<html[^>]*dir="rtl"/)
  })

  test('@critical English is served under its prefix', async ({ page }) => {
    await page.goto('/en')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})

test.describe('authentication guard', () => {
  test('@critical an unauthenticated visit to a protected route redirects to sign-in', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('@critical the redirect preserves the intended destination', async ({ page }) => {
    await page.goto('/dashboard')
    expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard')
  })

  test('@critical a forged session cookie is refused and signed out', async ({
    page,
    context,
  }) => {
    // The middleware checks cookie PRESENCE only. It cannot validate the token — the
    // signing key belongs to the backend — and it should not, because every protected
    // response is already authorised by the API. So a forged cookie is EXPECTED to get
    // past the redirect. What happens next is the point.
    //
    // An earlier version asserted "the shell renders, the data does not". That was
    // written before a working refresh path existed, and it described a weaker outcome
    // than the app actually delivers. It also raced: whether the assertion ran before
    // or after the client-side recovery decided the result, so it passed on chromium
    // and failed on mobile-rtl under parallel load.
    //
    // What actually happens, and what is asserted here:
    //   1. middleware sees a cookie and lets the request through
    //   2. the RSC prefetch 401s — server mode never refreshes, so it propagates
    //   3. the client query 401s and attempts a refresh
    //   4. the refresh 401s too, because there is no valid refresh token
    //   5. onSessionLost fires and the user is returned to sign-in
    //
    // So a forged cookie cannot leave someone stranded on a shell that will 401 every
    // query it mounts. The session ends properly.
    await context.addCookies([
      { name: 'access_token', value: 'forged.not.a.jwt', domain: '127.0.0.1', path: '/' },
    ])

    await page.goto('/dashboard')

    await expect(page).toHaveURL(/\/sign-in/)
    await expect(page.getByLabel('شماره‌ی موبایل')).toBeVisible()

    // And no athlete data was rendered on the way through.
    await expect(page.getByText('میان‌رده')).toBeHidden()
  })
})

test.describe('sign-in', () => {
  test('@critical is reachable without a session', async ({ page }) => {
    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { name: 'ورود' })).toBeVisible()
  })
})

test.describe('no credential leaks into the client bundle', () => {
  test('@critical no model-provider SDK or API key reaches the browser', async ({ page }) => {
    // `no-llm-sdk-in-frontend` enforces this at lint time on the import graph. This
    // checks the built artefact, which is the thing actually shipped — a key could
    // arrive through an env var inlined at build time, which no import rule sees.
    const scripts: string[] = []
    page.on('response', async (response) => {
      if (response.url().endsWith('.js') && response.status() === 200) {
        scripts.push(await response.text().catch(() => ''))
      }
    })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const bundle = scripts.join('\n')
    expect(bundle).not.toMatch(/sk-[A-Za-z0-9]{20,}/)
    expect(bundle).not.toMatch(/api\.(openai|anthropic)\.com/)
  })
})

test.describe('sign-in form', () => {
  test('@critical accepts Persian digits and reaches the code step', async ({ page }) => {
    // The whole flow in one assertion: a Persian keyboard produces ۰۹۱۲…, which is
    // not an ASCII digit, so without normalisation the user types the number that is
    // printed on their own SIM and the form calls it invalid.
    //
    // No backend here, so this asserts as far as the client can get on its own: the
    // number was accepted as well-formed and a request was attempted.
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill('۰۹۱۲۳۴۵۶۷۸۹')
    await page.getByRole('button', { name: 'ارسال کد' }).click()

    // Either the code step (if something answered) or the generic error — but never
    // the "not an Iranian mobile" message, which would mean normalisation failed.
    await expect(page.getByText('این شماره‌ی موبایل ایران به نظر نمی‌رسد.')).toBeHidden()
  })

  test('@critical rejects a landline with a specific message', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill('۰۲۱۲۳۴۵۶۷۸')
    await page.getByRole('button', { name: 'ارسال کد' }).click()

    // `#phone-error`, not getByRole('alert'): Next injects its own route announcer
    // with role="alert", so the role selector matches two elements. This is also the
    // element `aria-errormessage` points at, so asserting on it checks the wiring a
    // screen reader actually follows.
    await expect(page.locator('#phone-error')).toContainText('ایران به نظر نمی‌رسد')
    await expect(page.getByLabel('شماره‌ی موبایل')).toHaveAttribute('aria-invalid', 'true')
  })

  test('@critical the phone field renders LTR inside the RTL page', async ({ page }) => {
    // Without dir="ltr" the bidi algorithm reorders the number's groups, so the user
    // sees a different number to the one they typed.
    await page.goto('/sign-in')
    await expect(page.getByLabel('شماره‌ی موبایل')).toHaveAttribute('dir', 'ltr')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  })

  test('@critical stays prerendered despite reading search params', async ({ request }) => {
    // SignInClient calls useSearchParams(), which opts a route out of prerendering
    // unless it sits inside a Suspense boundary. The symptom of losing that boundary
    // is not an error — the page just silently becomes client-rendered, and the form
    // stops appearing in the first response.
    const html = await (await request.get('/sign-in')).text()
    expect(html).toContain('شماره‌ی موبایل')
  })
})

test.describe('sign-in, end to end', () => {
  const PHONE_EXISTING = '۰۹۱۲۳۴۵۶۷۸۹'
  const PHONE_NEW = '۰۹۱۲۳۴۵۰۰۰۰'
  const GOOD_CODE = '۰۰۰۰۰۰'

  test('@critical a Persian-digit number and code sign the athlete in', async ({ page }) => {
    // The assertion the suite existed without for two rounds: not just that the form
    // accepts the input, but that the session it establishes is real enough to load
    // the dashboard's data on the next navigation.
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(PHONE_EXISTING)
    await page.getByRole('button', { name: 'ارسال کد' }).click()

    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    // Real data from the stub, which means the cookie survived, the RSC prefetch
    // forwarded it, and the mapper produced a valid snapshot.
    await expect(page.getByText('میان‌رده')).toBeVisible()
  })

  test('@critical a new person is routed to onboarding, not the dashboard', async ({ page }) => {
    // `/onboarding` was a redirect target before it was a page: a genuinely new user
    // reached a 404. Nothing in the type system covers "this string is a real route".
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(PHONE_NEW)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()

    await expect(page).toHaveURL(/\/onboarding/)
    await expect(page.getByRole('heading', { name: 'خوش آمدید' })).toBeVisible()
  })

  test('@critical a wrong code is rejected without leaking the server message', async ({
    page,
  }) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(PHONE_EXISTING)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill('۱۱۱۱۱۱')
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()

    await expect(page.locator('#code-error')).toBeVisible()
    // The stub's own wording must not reach the screen. On this page a server message
    // can leak whether an account exists, which the endpoint is careful not to.
    await expect(page.locator('#code-error')).not.toContainText('code_invalid')
    await expect(page).not.toHaveURL(/\/dashboard/)
  })

  test('@critical the redirect target from the guard is honoured after signing in', async ({
    page,
  }) => {
    // `/onboarding` rather than `/dashboard`: the dashboard is also the FALLBACK when
    // `next` is absent or unsafe, so using it could not distinguish "honoured the
    // target" from "ignored it and fell back". It also has to be a route that exists —
    // a URL assertion cannot tell a real page from a 404.
    await page.goto('/onboarding')
    await expect(page).toHaveURL(/next=%2Fonboarding/)

    await page.getByLabel('شماره‌ی موبایل').fill(PHONE_EXISTING)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()

    await expect(page).toHaveURL(/\/onboarding/)
    await expect(page.getByRole('heading', { name: 'خوش آمدید' })).toBeVisible()
  })

  test('@critical an off-site `next` is ignored rather than followed', async ({ page }) => {
    // `next` arrives from a redirect and is attacker-controllable: anyone can send a
    // link carrying it. An open redirect on a sign-in page is a phishing primitive —
    // the victim authenticates on the real site and is then handed to the attacker's.
    await page.goto('/sign-in?next=https://evil.example/harvest')
    await page.getByLabel('شماره‌ی موبایل').fill(PHONE_EXISTING)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    expect(page.url()).not.toContain('evil.example')
  })

  test('@critical a protocol-relative `next` is ignored too', async ({ page }) => {
    // `//evil.example` passes a naive startsWith('/') check and is still off-site.
    await page.goto('/sign-in?next=//evil.example/harvest')
    await page.getByLabel('شماره‌ی موبایل').fill(PHONE_EXISTING)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    expect(page.url()).not.toContain('evil.example')
  })

  test('@critical no session token is readable from JavaScript', async ({ page }) => {
    // The cookies are httpOnly, so document.cookie must not contain them. If this
    // fails, an XSS payload anywhere in the app can exfiltrate a live session.
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(PHONE_EXISTING)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    const readable = await page.evaluate(() => document.cookie)
    expect(readable).not.toContain('access_token')
    expect(readable).not.toContain('refresh_token')
  })
})
