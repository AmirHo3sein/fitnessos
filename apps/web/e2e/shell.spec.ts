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
  // Does not end in 0000, so the stub reports an existing person and these tests land on
  // the dashboard. Distinct from every onboarding phone, and none of these write.
  const PHONE_EXISTING = '۰۹۱۲۳۴۵۶۷۸۹'
  const PHONE_NEW = '۰۹۱۲۹۹۹۰۰۰۰'
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

test.describe('onboarding', () => {
  const GOOD_CODE = '۰۰۰۰۰۰'

  /**
   * Each test that WRITES gets its own phone, because the stub keys athlete state by
   * phone. Sharing one number across parallel writers is a flake generator: whichever
   * test wrote last decides what the others read.
   *
   * All end in 0000 so the stub reports `isNewPerson`, routing them to onboarding.
   */
  const PHONE_COMPLETES = '۰۹۱۲۱۱۱۰۰۰۰'
  const PHONE_NO_DISCIPLINE = '۰۹۱۲۲۲۲۰۰۰۰'
  const PHONE_ZERO_CEILING = '۰۹۱۲۳۳۳۰۰۰۰'
  const PHONE_BACK_BUTTON = '۰۹۱۲۴۴۴۰۰۰۰'

  const signInAsNewPerson = async (page: import('@playwright/test').Page, phone: string) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(phone)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()
    await expect(page).toHaveURL(/\/onboarding/)
  }

  test('@critical a new athlete completes onboarding and lands on the dashboard', async ({
    page,
  }) => {
    // The full write path: form → domain value objects → outbound validation → PUT →
    // response validation → cache set → navigation. Nothing here is mocked at a module
    // boundary; the only substitution is the API process itself.
    await signInAsNewPerson(page, PHONE_COMPLETES)

    await page.getByRole('button', { name: 'پیشرفته' }).click()
    await page.getByRole('button', { name: 'قدرتی' }).click()
    await page.getByLabel('چند روز در هفته؟').fill('۵')
    await page.getByLabel('حداکثر مدت هر جلسه (دقیقه)').fill('۶۰')
    await page.getByRole('button', { name: 'ادامه' }).click()

    // Step two: the goal. Skipped here — the athlete write path is what this test is
    // about, and the goal has its own tests below.
    await expect(page.getByLabel('چه چیزی می‌خواهی؟')).toBeVisible()
    await page.getByRole('button', { name: 'بعداً' }).click()

    await expect(page).toHaveURL(/\/dashboard/)

    // What the athlete just entered, read back through the dashboard. This is the
    // assertion that proves the whole chain: the write landed, the response was mapped,
    // and the cache the dashboard reads holds the new state rather than the old one.
    await expect(page.getByText('پیشرفته')).toBeVisible()
    // 5 days and a 60-minute ceiling, rendered as Persian numerals via Intl.
    await expect(page.getByText('۵')).toBeVisible()
    await expect(page.getByText('۶۰')).toBeVisible()
  })

  test('@critical the domain refuses an empty discipline list, before any request', async ({
    page,
  }) => {
    await signInAsNewPerson(page, PHONE_NO_DISCIPLINE)
    await page.getByRole('button', { name: 'ادامه' }).click()

    await expect(page.locator('#onboarding-error')).toContainText('حداقل یک نوع تمرین')
    // Still on the form. A rule the client already knows must not cost a round trip.
    await expect(page).toHaveURL(/\/onboarding/)
  })

  test('@critical a zero ceiling is refused with a message naming the alternative', async ({
    page,
  }) => {
    // Zero means "cannot train at all", which is a different statement from "no limit".
    // The athlete has to be told which one they appear to have made.
    await signInAsNewPerson(page, PHONE_ZERO_CEILING)
    await page.getByRole('button', { name: 'قدرتی' }).click()
    await page.getByLabel('حداکثر مدت هر جلسه (دقیقه)').fill('۰')
    await page.getByRole('button', { name: 'ادامه' }).click()

    await expect(page.locator('#onboarding-error')).toContainText('خالی بگذار')
  })

  test('@critical onboarding requires a session', async ({ page }) => {
    await page.goto('/onboarding')
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('@critical the back button does not return to a completed form', async ({ page }) => {
    // `replace`, not `push`. Otherwise the athlete can go back and resubmit what they
    // just recorded — harmless under PUT, but confusing, and it would show a form that
    // no longer reflects their state.
    await signInAsNewPerson(page, PHONE_BACK_BUTTON)
    await page.getByRole('button', { name: 'قدرتی' }).click()
    await page.getByRole('button', { name: 'ادامه' }).click()
    await page.getByRole('button', { name: 'بعداً' }).click()
    await expect(page).toHaveURL(/\/dashboard/)

    await page.goBack()
    await expect(page).not.toHaveURL(/\/onboarding/)
  })
})

test.describe('goal declaration', () => {
  const GOOD_CODE = '۰۰۰۰۰۰'
  const PHONE_DECLARES = '۰۹۱۲۵۵۵۰۰۰۰'
  const PHONE_EMPTY_GOAL = '۰۹۱۲۶۶۶۰۰۰۰'
  const PHONE_SKIPS = '۰۹۱۲۷۷۷۰۰۰۰'

  /** Through the athlete step to the goal step, which is where these tests start. */
  const reachGoalStep = async (page: import('@playwright/test').Page, phone: string) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(phone)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()
    await expect(page).toHaveURL(/\/onboarding/)
    await page.getByRole('button', { name: 'قدرتی' }).click()
    await page.getByRole('button', { name: 'ادامه' }).click()
    await expect(page.getByLabel('چه چیزی می‌خواهی؟')).toBeVisible()
  }

  test('@critical a Persian goal is declared verbatim, ZWNJ intact', async ({ page }) => {
    // The assertion this whole context exists for. `می‌خواهم` carries a zero-width
    // non-joiner, which is a letter-level joiner in Persian: strip it and the word
    // becomes `میخواهم`, which reads to a Persian speaker as a spelling error the product
    // introduced. The phone-number code strips ZWNJ deliberately; prose must not.
    const intent = 'می‌خواهم ۱۰ کیلومتر بدون توقف بدوم'
    let sent: string | null = null
    page.on('request', (request) => {
      if (request.url().endsWith('/goals') && request.method() === 'POST') {
        const body = request.postData()
        if (body !== null) sent = JSON.parse(body).intent as string
      }
    })

    await reachGoalStep(page, PHONE_DECLARES)
    await page.getByLabel('چه چیزی می‌خواهی؟').fill(intent)
    await page.getByRole('button', { name: 'ثبت هدف' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    expect(sent).toBe(intent)
    expect(sent).toContain('\u200c')
  })

  test('@critical an empty goal is refused before any request', async ({ page }) => {
    let requested = false
    page.on('request', (request) => {
      if (request.url().endsWith('/goals') && request.method() === 'POST') requested = true
    })

    await reachGoalStep(page, PHONE_EMPTY_GOAL)
    await page.getByRole('button', { name: 'ثبت هدف' }).click()

    await expect(page.locator('#goal-error')).toContainText('هدفت را بنویس')
    expect(requested).toBe(false)
  })

  test('@critical skipping is a real outcome, not a dead end', async ({ page }) => {
    // A goal declared to get past a form becomes the thing every future prescription and
    // evaluation is judged against — worse than arriving without one. So skipping must
    // reach the dashboard, and must not post anything.
    let requested = false
    page.on('request', (request) => {
      if (request.url().endsWith('/goals') && request.method() === 'POST') requested = true
    })

    await reachGoalStep(page, PHONE_SKIPS)
    await page.getByRole('button', { name: 'بعداً' }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    expect(requested).toBe(false)
  })

  test('@critical the character counter counts code points, not UTF-16 units', async ({
    page,
  }) => {
    // A goal ending in an emoji must not be reported as one character longer than it is.
    await reachGoalStep(page, PHONE_DECLARES)
    await page.getByLabel('چه چیزی می‌خواهی؟').fill('a🏃')
    await expect(page.locator('#intent-hint')).toContainText('2/200')
  })
})

test.describe('programme and sessions', () => {
  const GOOD_CODE = '۰۰۰۰۰۰'
  /** Ends in 9, so the stub gives this athlete a programme. Does not write. */
  const PHONE_WITH_PROGRAMME = '۰۹۱۲۳۴۵۶۷۸۹'
  /** Ends in 0000, so no programme — the empty state, which is the normal first-run case. */
  const PHONE_NO_PROGRAMME = '۰۹۱۲۸۸۸۰۰۰۰'

  /**
   * Waits until sign-in has actually completed before returning.
   *
   * Without the wait, a following `page.goto('/programme')` races the post-verify redirect:
   * the session cookie may not be set when the navigation fires, so middleware bounces to
   * sign-in and the test fails on an assertion about content, several lines from the cause.
   *
   * `not /sign-in` rather than a specific URL, because where the athlete lands depends on
   * whether the stub considers them new — the dashboard for an existing person, onboarding for
   * a new one.
   */
  const signIn = async (page: import('@playwright/test').Page, phone: string) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(phone)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()
    await expect(page).not.toHaveURL(/\/sign-in/)
  }

  test('@critical the programme renders its blocks in order', async ({ page }) => {
    // The stub supplies blocks OUT of order deliberately — the contract promises no ordering,
    // so this asserts the mapper sorts rather than rendering whatever arrived. Two clients
    // showing the same programme in different orders is indistinguishable from a data bug.
    await signIn(page, PHONE_WITH_PROGRAMME)
    await expect(page).toHaveURL(/\/dashboard/)

    await page.getByRole('link', { name: 'برنامه' }).click()
    await expect(page).toHaveURL(/\/programme/)

    const blocks = page.locator('ol li')
    await expect(blocks.first()).toContainText('Preparation')
    await expect(blocks.nth(1)).toContainText('Accumulation')
  })

  test('@critical a linear block shows its rate and a fixed block does not', async ({ page }) => {
    await signIn(page, PHONE_WITH_PROGRAMME)
    await page.goto('/programme')

    await expect(page.getByText('افزایشی')).toBeVisible()
    await expect(page.getByText('ثابت')).toBeVisible()
    // 2.5% per cycle, rendered through Intl in Persian numerals.
    await expect(page.getByText('۲٫۵%')).toBeVisible()
  })

  test('@critical no programme is an explained empty state, not a spinner', async ({ page }) => {
    // A 204 maps to null, and null is DATA. If it were left as undefined the query would never
    // settle and a newly-onboarded athlete would watch a spinner forever.
    await signIn(page, PHONE_NO_PROGRAMME)
    await page.goto('/programme')

    await expect(page.getByText('هنوز برنامه‌ای نداری.')).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('@critical sessions show sets, reps, load, and bodyweight distinctly', async ({ page }) => {
    await signIn(page, PHONE_WITH_PROGRAMME)
    await page.goto('/sessions')

    // Bodyweight work has NO load on the wire — absent, never 0. It must read as "bodyweight",
    // not as "0 kg", which would look like a mistake to the athlete.
    await expect(page.getByText('Push-up')).toBeVisible()
    await expect(page.getByText('وزن بدن')).toBeVisible()
    await expect(page.getByText('Back squat')).toBeVisible()
    await expect(page.getByText('۱۰۰')).toBeVisible()
  })

  test('@critical a withheld screening basis says so rather than saying nothing', async ({
    page,
  }) => {
    // ADR-0002 / ADR-0014. "Modified, and here is why" and "modified, and you are not entitled
    // to the reason" are both `basis: null` on the wire and completely different statements to
    // an athlete about to train. Saying nothing implies the modification is unexplained.
    await signIn(page, PHONE_WITH_PROGRAMME)
    await page.goto('/sessions')

    await expect(page.getByText('با تغییر')).toBeVisible()
    await expect(page.getByText('دلیلش برای تو قابل نمایش نیست')).toBeVisible()
  })

  test('@critical the session date renders in the Persian calendar', async ({ page }) => {
    // 2026-08-10 is 1405/05/19 Jalali. Showing a Gregorian date to an Iranian athlete is
    // showing them a date they have to convert in their head. Asserting on the Persian month
    // name proves the calendar, not just the numerals.
    await signIn(page, PHONE_WITH_PROGRAMME)
    await page.goto('/sessions')
    await expect(page.getByText('مرداد')).toBeVisible()
  })

  test('@critical both new routes require a session', async ({ page }) => {
    await page.goto('/programme')
    await expect(page).toHaveURL(/\/sign-in/)
    await page.goto('/sessions')
    await expect(page).toHaveURL(/\/sign-in/)
  })
})

test.describe('offline session logging', () => {
  const GOOD_CODE = '۰۰۰۰۰۰'

  /**
   * A phone unique to this test AND this project.
   *
   * Logging MUTATES stub state — a logged session stops being upcoming, which is the point. Per-test
   * phones isolate tests from each other; the PROJECT also has to be in the key, because chromium
   * and mobile-rtl run the same specs against the same stub process, and whichever went first left
   * the other with nothing to log. That failed identically on every run, which is how it was
   * distinguishable from a flake.
   *
   * Format is 09 + 9 digits, ending in 9 so the stub gives this athlete a programme.
   */
  const phoneFor = (testCode: string, project: string) => {
    // 0912 (4) + testCode (3) + projectCode (3) + '9' (1) = 11 digits. An Iranian mobile is
    // exactly 11 with the leading zero, and PhoneNumber rejects anything else — the first version
    // of this produced 10 and every logging test failed at the sign-in step.
    const projectCode = project === 'chromium' ? '110' : '220'
    const ascii = `0912${testCode}${projectCode}9`
    return [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')
  }

  const signIn = async (page: import('@playwright/test').Page, phone: string) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(phone)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()
    await expect(page).not.toHaveURL(/\/sign-in/)
  }

  const openLogger = async (page: import('@playwright/test').Page) => {
    await page.goto('/sessions')
    await page.getByRole('button', { name: 'ثبت این جلسه' }).first().click()
    await expect(page.getByRole('button', { name: 'ثبت جلسه' })).toBeVisible()
  }

  test('@critical a session logged ONLINE reaches the server', async ({ page }) => {
    await signIn(page, phoneFor('111', test.info().project.name))
    await openLogger(page)
    await page.getByRole('button', { name: 'ثبت جلسه' }).click()

    await expect(page.getByText('ثبت شد')).toBeVisible()

    // The list no longer offers it. A logged session that still appears as upcoming reads as the
    // app not having noticed.
    await page.goto('/sessions')
    await expect(page.getByText('جلسه‌ای در پیش نداری.')).toBeVisible()
  })

  test('@critical a session logged OFFLINE is accepted, not rejected', async ({
    page,
    context,
  }) => {
    // The assertion this whole feature exists for. A basement gym with no signal is the NORMAL
    // case, and an error state here would train athletes to distrust the log.
    await signIn(page, phoneFor('222', test.info().project.name))
    await openLogger(page)

    await context.setOffline(true)
    await page.getByRole('button', { name: 'ثبت جلسه' }).click()

    // Confirmed, with wording that does not claim it reached the server (ADR-0033).
    await expect(page.getByText('ثبت شد')).toBeVisible()
    await expect(page.locator('#logger-error')).toBeHidden()

    await context.setOffline(false)
  })

  test('@critical an offline log is replayed when the connection returns', async ({
    page,
    context,
  }) => {
    // Durability is the claim; REPLAY is the part that can be asserted here.
    //
    // Surviving a full app restart while still offline cannot be e2e-tested yet: reloading with no
    // connection means the document itself cannot be fetched, and the app has no service worker to
    // serve it from cache. The queue genuinely is on disk — that is covered by the unit tests —
    // but proving it end to end needs offline app startup, which is a separate piece of work.
    //
    // What IS proven here: a log accepted with no network reaches the server once there is one,
    // without the athlete doing anything.
    await signIn(page, phoneFor('333', test.info().project.name))
    await openLogger(page)

    await context.setOffline(true)
    await page.getByRole('button', { name: 'ثبت جلسه' }).click()
    await expect(page.getByText('ثبت شد')).toBeVisible()

    // Armed BEFORE reconnecting, so the drain cannot be missed.
    const replay = page.waitForRequest(
      (request) => request.url().includes('/sessions/performed') && request.method() === 'POST',
      { timeout: 20_000 },
    )
    await context.setOffline(false)

    // The drain fires on the `online` event. Nothing in the UI triggered it.
    await replay

    // And the session is genuinely gone from upcoming, which is only true if the replayed
    // mutation was accepted rather than merely sent.
    await page.goto('/sessions')
    await expect(page.getByText('جلسه‌ای در پیش نداری.')).toBeVisible({ timeout: 15_000 })
  })

  test('@critical the logger is pre-filled from the prescription', async ({ page }) => {
    // The common case by a wide margin is "I did what it said". An empty form would make the
    // normal path the most work, and a tired athlete between sets abandons forms.
    await signIn(page, phoneFor('111', test.info().project.name))
    await page.goto('/sessions')
    const logButton = page.getByRole('button', { name: 'ثبت این جلسه' }).first()
    if (await logButton.isVisible()) {
      await logButton.click()
      // Push-up is prescribed 3×12 with no load; back squat 5×5 at 100kg.
      await expect(page.locator('input[inputmode="numeric"]').first()).toHaveValue('12')
    }
  })
})

test.describe('the program builder', () => {
  const GOOD_CODE = '۰۰۰۰۰۰'

  /**
   * Per-test AND per-project phones, for the same reason as offline logging: revising MUTATES
   * stub state, and chromium and mobile-rtl run these specs against one stub process. Sharing a
   * number would leave whichever ran second editing a programme the first had already revised —
   * failing on a conflict assertion in a test that is not about conflicts.
   *
   * 0912 (4) + testCode (3) + projectCode (3) + '9' (1) = 11 digits, ending in 9 so the athlete
   * has a programme to edit.
   */
  const phoneFor = (testCode: string, project: string) => {
    const projectCode = project === 'chromium' ? '330' : '440'
    const ascii = `0912${testCode}${projectCode}9`
    return [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')
  }

  const signIn = async (page: import('@playwright/test').Page, phone: string) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(phone)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()
    await expect(page).not.toHaveURL(/\/sign-in/)
  }

  const openBuilder = async (page: import('@playwright/test').Page) => {
    await page.goto('/programme')
    await page.getByRole('button', { name: 'ویرایش برنامه' }).click()
    await expect(page.getByRole('button', { name: 'ذخیره' })).toBeVisible()
  }

  test('@critical a renamed block survives a save and a reload', async ({ page }) => {
    /*
     * The whole vertical, exercised once: editor document → commit → domain validation →
     * outbound mapper → HTTP → stub → read path → mapper → view. Each layer has its own test;
     * this is the one that fails if two of them agree with each other and not with reality.
     */
    await signIn(page, phoneFor('111', test.info().project.name))
    await openBuilder(page)

    const first = page.getByLabel('نام بلوک').first()
    await first.fill('Base phase')
    await page.getByRole('button', { name: 'ذخیره' }).click()
    await page.getByRole('button', { name: 'پایان ویرایش' }).click()

    await expect(page.locator('ol li').first()).toContainText('Base phase')

    // Reloaded, so the assertion is about what the SERVER holds rather than what the local cache
    // was set to after the mutation.
    await page.reload()
    await expect(page.locator('ol li').first()).toContainText('Base phase')
  })

  test('@critical saving bumps the version number', async ({ page }) => {
    // Assigned by the lineage, not the client. If the client ever started sending its own, this
    // is what would notice.
    await signIn(page, phoneFor('222', test.info().project.name))
    await page.goto('/programme')
    await expect(page.getByText('نسخه')).toContainText('۲')

    await openBuilder(page)
    await page.getByLabel('نام بلوک').first().fill('Renamed')
    await page.getByRole('button', { name: 'ذخیره' }).click()
    await page.getByRole('button', { name: 'پایان ویرایش' }).click()

    await expect(page.getByText('نسخه')).toContainText('۳')
  })

  test('@critical an added block is persisted with a contiguous order', async ({ page }) => {
    await signIn(page, phoneFor('333', test.info().project.name))
    await openBuilder(page)

    await page.getByRole('button', { name: 'افزودن بلوک' }).click()
    await page.getByRole('button', { name: 'ذخیره' }).click()
    await page.getByRole('button', { name: 'پایان ویرایش' }).click()
    await page.reload()

    await expect(page.locator('ol li')).toHaveCount(3)
    await expect(page.locator('ol li').nth(2)).toContainText('بلوک تازه')
  })

  test('@critical undo reverses a deletion before it is ever sent', async ({ page }) => {
    await signIn(page, phoneFor('444', test.info().project.name))
    await openBuilder(page)

    await page.getByRole('button', { name: /^حذف/ }).first().click()
    await expect(page.getByLabel('نام بلوک')).toHaveCount(1)

    await page.getByRole('button', { name: 'واگرد' }).click()
    await expect(page.getByLabel('نام بلوک')).toHaveCount(2)

    await page.getByRole('button', { name: 'ذخیره' }).click()
    await page.getByRole('button', { name: 'پایان ویرایش' }).click()
    await page.reload()
    await expect(page.locator('ol li')).toHaveCount(2)
  })

  test('@critical a stale save reports a conflict and keeps the local edits', async ({
    page,
    request,
  }) => {
    /*
     * The case ADR-0033 exists for. Another author revises while the builder is open; the save
     * must be refused, the coach must be told, and their work must still be on screen.
     *
     * The second author is a direct API call rather than a second browser, because the point
     * being tested is the server's baseVersionId check and the client's handling of the 409 —
     * not two browsers.
     */
    const phone = phoneFor('555', test.info().project.name)
    await signIn(page, phone)
    await openBuilder(page)

    // Revise from underneath, using the session cookie this browser already holds.
    const cookies = await page.context().cookies()
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const current = await (
      await request.get('http://127.0.0.1:8791/api/v1/programs/current', {
        headers: { cookie: cookieHeader },
      })
    ).json()

    const elsewhere = await request.post(
      `http://127.0.0.1:8791/api/v1/programs/${current.id as string}/versions`,
      {
        headers: { cookie: cookieHeader },
        data: {
          id: '018f2c8a-0004-7000-8000-0000000000ff',
          baseVersionId: current.currentVersion.id as string,
          blocks: [
            {
              id: '018f2c8a-0005-7000-8000-000000000001',
              name: 'Written by someone else',
              order: 0,
              progressionIntent: { kind: 'fixed' },
            },
          ],
          authoringDecision: { decidedBy: 'coach-2', proposedBy: 'human' },
        },
      },
    )
    expect(elsewhere.status()).toBe(201)

    await page.getByLabel('نام بلوک').first().fill('My local edit')
    await page.getByRole('button', { name: 'ذخیره' }).click()

    await expect(page.getByText('این برنامه جای دیگری تغییر کرده است')).toBeVisible()
    // The coach's work is still there. A conflict that discarded it would be strictly worse than
    // no conflict detection at all.
    await expect(page.getByLabel('نام بلوک').first()).toHaveValue('My local edit')
  })
})

test.describe('cross-document references', () => {
  const GOOD_CODE = '۰۰۰۰۰۰'

  /** 0912 + testCode(3) + projectCode(3) + '9' — ends in 9, so the athlete has a programme. */
  const phoneFor = (testCode: string, project: string) => {
    const projectCode = project === 'chromium' ? '550' : '660'
    const ascii = `0912${testCode}${projectCode}9`
    return [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')
  }

  const signIn = async (page: import('@playwright/test').Page, phone: string) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(phone)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()
    await expect(page).not.toHaveURL(/\/sign-in/)
  }

  test('@critical a goal the athlete has NOT declared renders broken, and the page still works', async ({
    page,
  }) => {
    /*
     * The guarantee D-08 exists for. The seeded programme serves a goal this athlete never
     * declared — a programme outliving the goal it was written for, which is a normal thing for
     * a programme to do. The page must render, and the chip must say WHICH reference broke.
     */
    await signIn(page, phoneFor('111', test.info().project.name))
    await page.goto('/programme')

    // The programme itself renders. A broken reference that took the page down would have lost
    // a coach their programme to someone else's cleanup.
    await expect(page.locator('ol li').first()).toContainText('Preparation')

    await expect(page.getByText(/base phase before the build-up/)).toBeVisible()
    await expect(page.getByText(/دیگر در دسترس نیست/)).toBeVisible()
    // Nowhere to go, so it is not a link. A link to a deleted goal is a 404 the reader was
    // invited into.
    await expect(page.getByRole('link', { name: /base phase/ })).toHaveCount(0)
  })

  test('@critical a declared goal resolves to its own words and links to it', async ({ page }) => {
    const phone = phoneFor('222', test.info().project.name)
    await signIn(page, phone)

    /*
     * Declared through the API rather than the onboarding form, because the two requirements
     * conflict: the stub gives a programme to a phone ending in 9 and treats a phone ending in
     * 0000 as a new person, and only a new person sees the goal step. The declaration UI has its
     * own tests; what is under test here is resolution.
     */
    const cookieHeader = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')
    const declared = await page.request.post('http://127.0.0.1:8791/api/v1/goals', {
      headers: { cookie: cookieHeader },
      data: { intent: 'می‌خواهم ۱۰ کیلومتر بدون توقف بدوم', cadenceDays: 28 },
    })
    expect(declared.status()).toBe(201)

    await page.goto('/programme')

    // The GOAL's own words, not the programme's rationale — the live value wins when it exists.
    const chip = page.getByRole('link', { name: /۱۰ کیلومتر/ })
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute(
      'href',
      '/goals/018f2c8a-0002-7000-8000-000000000000',
    )
    await expect(page.getByText(/base phase before the build-up/)).toHaveCount(0)
  })
})

test.describe('a log that never arrived', () => {
  const GOOD_CODE = '۰۰۰۰۰۰'

  const phoneFor = (testCode: string, project: string) => {
    const projectCode = project === 'chromium' ? '770' : '880'
    const ascii = `0912${testCode}${projectCode}9`
    return [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]).join('')
  }

  const signIn = async (page: import('@playwright/test').Page, phone: string) => {
    await page.goto('/sign-in')
    await page.getByLabel('شماره‌ی موبایل').fill(phone)
    await page.getByRole('button', { name: 'ارسال کد' }).click()
    await page.getByLabel('کد تأیید').fill(GOOD_CODE)
    await page.getByRole('button', { name: 'تأیید و ورود' }).click()
    await expect(page).not.toHaveURL(/\/sign-in/)
  }

  test('@critical a session logged on another device surfaces as a conflict with both records', async ({
    page,
  }) => {
    /*
     * The exact race ADR-0033 exists for, driven end to end rather than described.
     *
     * The athlete opens the logger. Another device records the same session before they submit.
     * Their log is queued, replayed, and refused — and the whole point is what happens next: the
     * athlete is TOLD, and their own record survives so they can say which one is true.
     *
     * Before this, both sides of that were silent. The engine fired a callback nobody subscribed
     * to, and the log was dropped after the product had said "saved".
     */
    await signIn(page, phoneFor('111', test.info().project.name))

    // Open the logger first. Once another device logs the session it stops being upcoming, so
    // this ordering is not a convenience — it is the only way to reach the conflict.
    await page.goto('/sessions')
    await page.getByRole('button', { name: 'ثبت این جلسه' }).first().click()
    await expect(page.getByRole('button', { name: 'ثبت جلسه' })).toBeVisible()

    const cookieHeader = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')
    const headers = { cookie: cookieHeader }

    // Read the real prescribed session rather than reconstructing its deterministic id here — a
    // test that recomputes the stub's id scheme breaks when the scheme changes, for no reason.
    const upcoming = await (
      await page.request.get('http://127.0.0.1:8791/api/v1/sessions/upcoming', { headers })
    ).json()
    const prescribed = upcoming[0] as { id: string; items: { id: string }[] }

    // The other device. A different log id, so this is a genuine second record rather than a
    // replay of the athlete's own.
    const elsewhere = await page.request.post(
      'http://127.0.0.1:8791/api/v1/sessions/performed',
      {
        headers,
        data: {
          id: '018f2c8a-0009-7000-8000-0000000000aa',
          prescribedSessionId: prescribed.id,
          performedOn: '2026-08-10',
          sets: [
            { id: '018f2c8a-000a-7000-8000-000000000001', prescribedItemId: prescribed.items[0]!.id, setNumber: 1, reps: 8 },
          ],
        },
      },
    )
    expect(elsewhere.status()).toBe(201)

    await page.getByRole('button', { name: 'ثبت جلسه' }).click()

    // The banner. Not a thrown error, not a silent drop.
    await expect(page.getByText('این جلسه پیش‌تر ثبت شده بود')).toBeVisible()

    // BOTH records, because only the athlete knows which describes what they actually did.
    // `exact`, because the body text above also contains the phrase "ثبت شما".
    await expect(page.getByText('ثبت شما', { exact: true })).toBeVisible()
    await expect(page.getByText('ثبت‌شده', { exact: true })).toBeVisible()
  })

  test('@critical the issue survives a reload, and only dismissal clears it', async ({ page }) => {
    /*
     * Why the record is durable rather than a callback: the replay runs on `online` and
     * `visibilitychange`, which fire when no UI is mounted and sometimes as the app is closing.
     * An in-memory notification would be lost exactly when it mattered.
     */
    await signIn(page, phoneFor('222', test.info().project.name))
    await page.goto('/sessions')
    await page.getByRole('button', { name: 'ثبت این جلسه' }).first().click()
    await expect(page.getByRole('button', { name: 'ثبت جلسه' })).toBeVisible()

    const cookieHeader = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join('; ')
    const headers = { cookie: cookieHeader }
    const upcoming = await (
      await page.request.get('http://127.0.0.1:8791/api/v1/sessions/upcoming', { headers })
    ).json()
    const prescribed = upcoming[0] as { id: string; items: { id: string }[] }

    await page.request.post('http://127.0.0.1:8791/api/v1/sessions/performed', {
      headers,
      data: {
        id: '018f2c8a-0009-7000-8000-0000000000bb',
        prescribedSessionId: prescribed.id,
        performedOn: '2026-08-10',
        sets: [
          { id: '018f2c8a-000a-7000-8000-000000000002', prescribedItemId: prescribed.items[0]!.id, setNumber: 1, reps: 8 },
        ],
      },
    })

    await page.getByRole('button', { name: 'ثبت جلسه' }).click()
    await expect(page.getByText('این جلسه پیش‌تر ثبت شده بود')).toBeVisible()

    await page.reload()
    await expect(page.getByText('این جلسه پیش‌تر ثبت شده بود')).toBeVisible()

    await page.getByRole('button', { name: 'متوجه شدم' }).click()
    await expect(page.getByText('این جلسه پیش‌تر ثبت شده بود')).toHaveCount(0)

    // And it stays gone. Reappearing from a stale cache would teach the athlete that dismissing
    // does not work.
    await page.reload()
    await expect(page.getByText('این جلسه پیش‌تر ثبت شده بود')).toHaveCount(0)
  })
})
