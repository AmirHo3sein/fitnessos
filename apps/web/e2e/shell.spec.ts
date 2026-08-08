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

  test('@critical a forged session cookie does not grant access to data', async ({
    page,
    context,
  }) => {
    // The middleware checks cookie PRESENCE only — it cannot validate the token,
    // because the signing key belongs to the backend. So a forged cookie is
    // expected to get past the redirect and then be refused by the API.
    //
    // This test exists to keep that boundary honest. If it ever starts failing
    // because the shell renders real data, the middleware has been mistaken for a
    // security gate somewhere.
    await context.addCookies([
      { name: 'access_token', value: 'forged.not.a.jwt', domain: '127.0.0.1', path: '/' },
    ])

    await page.goto('/dashboard')

    // The security-relevant claim, and the only one assertable without a backend:
    // the guard let the request through, so it is not acting as an authorisation
    // boundary. The API is what refuses.
    await expect(page).not.toHaveURL(/\/sign-in/)
    await expect(page.locator('header')).toBeVisible()

    // Deliberately NOT asserting on the athlete data here. Proving that the forged
    // cookie yields no data requires an API that rejects it, and there is none in
    // this suite. Asserting "the error message is visible" against a backend that
    // is simply absent would pass for the wrong reason and keep passing after the
    // guard was broken.
    //
    // TODO: assert the refusal once a stub API exists for E2E (see ADR-0026 —
    // the same stub the contract pipeline will need).
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
