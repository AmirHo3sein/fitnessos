import { expect, test } from '@playwright/test'

/**
 * The production topology, driven by a real browser, against the REAL Rust backend.
 *
 *   Browser → Caddy :18080 → Next.js :3000 (production build) → Rust API :8791 → PostgreSQL
 *
 * ## Why this exists when there is already an e2e suite
 *
 * `e2e/` runs against the stub, through Next's dev rewrite, on `127.0.0.1:3000`. That is the right
 * shape for asserting product behaviour — the stub can inject faults a real backend will not — but
 * it verifies none of the things a deployment gets wrong:
 *
 *   - the app and the API are ONE ORIGIN, so a session cookie travels with no `withCredentials`
 *     and no CORS anywhere. Two ports are two origins, and the dev rewrite hides the difference.
 *   - the build has no `/api/v1` rewrite at all. The rewrite is gated on `STUB_API_URL`
 *     (`next.config.ts`) precisely so a production build cannot route API traffic somewhere
 *     unintended — which means the production build depends on the proxy being there.
 *   - the RSC prefetch reaches the API server-side over `INTERNAL_API_URL` while the browser
 *     reaches it over a relative path. Those are different code paths to the same data, and only
 *     one of them is exercised by curl.
 *   - SSE survives a reverse proxy (§5.2), which cannot be observed without one in the path.
 *
 * ## How to run it
 *
 *   docker compose -f tools/local-production/docker-compose.yml up -d
 *   # the Rust API on :8791 with DEV_OTP_CODE set, and:
 *   INTERNAL_API_URL=http://127.0.0.1:8791/api/v1 pnpm --filter @fitnessos/web start
 *   npx playwright test tools/local-production/smoke.spec.ts --config tools/local-production/smoke.config.ts
 *
 * Deliberately NOT part of `pnpm check`: it needs a database, a built app and a proxy, and a gate
 * that cannot run on a laptop with one command is a gate people learn to skip.
 */

const ORIGIN = process.env['SMOKE_ORIGIN'] ?? 'http://127.0.0.1:18080'
const OTP = process.env['SMOKE_OTP'] ?? '123456'

/** A number nobody else in this database has used. */
const freshPhone = () => `0912${String(Date.now()).slice(-7)}`

const toPersianDigits = (ascii: string) =>
  [...ascii].map((d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d).join('')

test('the whole path works on one origin, with nothing stubbed', async ({ page }) => {
  const apiCalls: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/api/v1')) apiCalls.push(url)
  })

  const phone = freshPhone()

  await page.goto(`${ORIGIN}/fa/sign-in`)
  await page.getByLabel('شماره‌ی موبایل').fill(toPersianDigits(phone))
  await page.getByRole('button', { name: 'ارسال کد' }).click()
  await page.getByLabel('کد تأیید').fill(toPersianDigits(OTP))
  await page.getByRole('button', { name: 'تأیید و ورود' }).click()

  await expect(page).not.toHaveURL(/\/sign-in/)

  /*
   * The cookie is the point. It was set by the API and sent back by the browser without anybody
   * asking for credentials, which is only true because the proxy put both on one origin.
   */
  const cookies = await page.context().cookies()
  const access = cookies.find((c) => c.name === 'access_token')
  expect(access, 'the session cookie must exist').toBeDefined()
  expect(access?.httpOnly, 'HttpOnly, or an XSS exfiltrates the session').toBe(true)
  expect(access?.sameSite).toBe('Lax')
  expect(new URL(ORIGIN).hostname).toBe(access?.domain?.replace(/^\./, ''))

  /*
   * Every API call the browser made must be RELATIVE to this origin. One absolute URL to :8791
   * here would mean the app only works because both happen to be on this machine.
   */
  expect(apiCalls.length, 'the browser must have called the API').toBeGreaterThan(0)
  for (const url of apiCalls) {
    expect(url.startsWith(ORIGIN), `not same-origin: ${url}`).toBe(true)
  }

  /*
   * A brand-new person has no athlete yet, so onboarding is where they land — and THAT is what
   * proves the server render reached the real API rather than a fixture. The stub decides who has
   * a programme from the last digit of their phone; this answer came from a 404 on
   * `GET /athletes/me` against a row that does not exist in Postgres.
   */
  await expect(page).toHaveURL(/\/onboarding/)
  await expect(page.getByText('چقدر تمرین کرده‌ای؟')).toBeVisible()
})

test('the stream survives the proxy, and resumes from a position it gave out', async ({ page }) => {
  // §5.2 and §5.3, THROUGH the proxy. `curl` against the origin proves neither.
  const phone = freshPhone()

  await page.goto(`${ORIGIN}/fa/sign-in`)
  await page.getByLabel('شماره‌ی موبایل').fill(toPersianDigits(phone))
  await page.getByRole('button', { name: 'ارسال کد' }).click()
  await page.getByLabel('کد تأیید').fill(toPersianDigits(OTP))
  await page.getByRole('button', { name: 'تأیید و ورود' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)

  const opened = await page.evaluate(
    async () =>
      await new Promise<{ readonly first: string; readonly ms: number }>((resolve, reject) => {
        const started = performance.now()
        const source = new EventSource('/api/v1/events')
        const timer = setTimeout(() => {
          source.close()
          reject(new Error('nothing arrived within 5s — the proxy is buffering'))
        }, 5000)

        // `onopen` fires when the browser has the response HEADERS, which a buffering proxy
        // withholds until the first body byte. That is the failure §5.2 is written from, and the
        // prelude byte is what prevents it.
        source.onopen = () => {
          clearTimeout(timer)
          const ms = performance.now() - started
          source.close()
          resolve({ first: 'open', ms })
        }
        source.onerror = () => {
          clearTimeout(timer)
          source.close()
          reject(new Error('EventSource errored'))
        }
      }),
  )

  expect(opened.first).toBe('open')
  expect(opened.ms, 'the stream must open promptly through the proxy').toBeLessThan(3000)
})
