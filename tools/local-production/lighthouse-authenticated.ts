#!/usr/bin/env node
/**
 * Lighthouse on the pages that are behind the login, against the REAL backend.
 *
 * ## What `lighthouserc.cjs` says was impossible, and what changed
 *
 * That config records two abandoned attempts at authenticated routes, and both objections were
 * correct at the time:
 *
 *   1. `settings.extraHeaders: { Cookie: … }` authenticates the DOCUMENT request and puts nothing
 *      in the browser's cookie jar. The shell rendered, the client's own `/api/v1/*` calls went out
 *      unauthenticated, 401'd, and all three runs finished on `/sign-in` — measuring a redirect
 *      while reporting a healthy score.
 *   2. `collect.puppeteerScript` is the supported answer and means a second Chromium download
 *      beside the one Playwright already manages, which is a permanent cost for a lab number.
 *
 * The third option is neither. Lighthouse can attach to an ALREADY-RUNNING Chrome over CDP
 * (`--port`), and Playwright can launch one — the Chromium it has downloaded anyway — with a
 * persistent profile. Signing in through the UI then puts the session in a real cookie jar, so the
 * client's own API calls are authenticated and the page under measurement is the page.
 *
 * The check that proves it: `finalDisplayedUrl`. It is asserted per route below, because a silent
 * redirect to `/sign-in` reporting a healthy score is the exact failure mode that made the first
 * attempt worthless — and it fails quietly unless something looks.
 *
 * ## Why `npx --yes lighthouse@12` and not a dependency
 *
 * `pnpm-workspace.yaml` records why `@lhci/cli` is not a workspace dependency: it reaches
 * `extract-zip` (GHSA-jmr9-qjv8-65gv) through lighthouse → puppeteer-core → @puppeteer/browsers,
 * with no fixed version available. Adding `lighthouse` here would put the same path back in the
 * lockfile. Run through `npx`, it resolves nothing into this workspace.
 *
 * ## Why a fresh profile every run
 *
 * The app uses IndexedDB for its offline queue, and Lighthouse warns — correctly — that stored data
 * affects loading performance. A profile reused between runs would make the second measurement
 * quietly different from the first, which is worse than no measurement.
 *
 *   node tools/local-production/lighthouse-authenticated.mjs
 */

import { chromium, type APIResponse, type BrowserContext, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = promisify(execFile)

/** Only the fields this script reads. Lighthouse's report is very large and mostly irrelevant here. */
interface Report {
  readonly finalDisplayedUrl: string
  readonly categories: Record<string, { readonly score: number }>
  readonly audits: Record<
    string,
    { readonly numericValue?: number; readonly details?: { readonly items?: readonly unknown[] } }
  >
}

interface Measurement {
  readonly perf: number
  readonly a11y: number
  readonly bp: number
  readonly lcp: number
  readonly cls: number
  readonly tbt: number
  readonly ttfb: number
  readonly si: number
  readonly errors: number
}

const ORIGIN = process.env['SMOKE_ORIGIN'] ?? 'http://127.0.0.1:18080'
const OTP = process.env['SMOKE_OTP'] ?? '123456'
const PORT = 9222
const RUNS = Number(process.env['LH_RUNS'] ?? 3)

/** The routes worth a lab number, heaviest last. `automation` is the largest bundle in the app. */
const ROUTES = ['/dashboard', '/sessions', '/programme', '/plan', '/report', '/automation']

const fa = (value: string): string =>
  value.replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)] ?? digit)

const newId = (): string => {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  const ms = BigInt(Date.now())
  for (let i = 0; i < 6; i += 1) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date())

/**
 * A signed-in athlete with a programme and a session to log.
 *
 * An EMPTY dashboard is not a representative measurement: the interesting cost is rendering a
 * derived indicator series and a list of prescribed work, and an athlete with neither measures the
 * empty state. So the account is seeded through the published API first.
 */
const seed = async (context: BrowserContext, page: Page): Promise<void> => {
  const phone = `0912${String(Date.now()).slice(-7)}`

  await page.goto(`${ORIGIN}/fa/sign-in`)
  await page.getByLabel('شماره‌ی موبایل').fill(fa(phone))
  await page.getByRole('button', { name: 'ارسال کد' }).click()
  await page.getByLabel('کد تأیید').fill(fa(OTP))
  await page.getByRole('button', { name: 'تأیید و ورود' }).click()
  await page.waitForURL((u: URL) => !u.pathname.endsWith('/sign-in'), { timeout: 15_000 })

  const api = context.request
  // Not async: it inspects an already-resolved response. Awaiting the CALL is the caller's job,
  // and marking this async would make `ok(...)` look like it does I/O of its own.
  const ok = (label: string, response: APIResponse): APIResponse => {
    if (response.status() >= 400) throw new Error(`${label}: ${String(response.status())}`)
    return response
  }

  ok('onboarding', await api.put(`${ORIGIN}/api/v1/athletes/me/onboarding`, {
    data: {
      trainingIdentity: { experienceLevel: 'intermediate', disciplines: ['strength'] },
      availability: { daysPerWeek: 4, sessionCeilingSeconds: 4200, equipmentAccess: ['barbell'] },
    },
  }))

  const programId = newId()
  ok('programme', await api.post(`${ORIGIN}/api/v1/programs`, {
    data: {
      id: programId, title: 'Base',
      blocks: [{ id: newId(), name: 'Accumulation', order: 0,
                 progressionIntent: { kind: 'linear', ratePercent: 2.5 } }],
      authoringDecision: { decidedBy: 'self', proposedBy: 'human' },
    },
  }))

  const sessionId = newId()
  const itemId = newId()
  ok('prescription', await api.post(`${ORIGIN}/api/v1/programs/${programId}/sessions`, {
    data: {
      id: sessionId, scheduledFor: today(),
      items: [{ id: itemId, movementName: 'Back squat', order: 0, sets: 5, reps: 5, loadKg: 100 }],
      screening: { level: 'clear' },
    },
  }))

  // A logged session, so the dashboard has a derived indicator series to render rather than an
  // empty state — which is what makes this a measurement of the real page.
  ok('log', await api.post(`${ORIGIN}/api/v1/sessions/performed`, {
    data: {
      id: newId(), prescribedSessionId: sessionId, performedOn: today(),
      sets: [{ id: newId(), prescribedItemId: itemId, setNumber: 1, reps: 5, loadKg: 100 }],
    },
  }))
}

/*
 * `async`, and that is not cosmetic.
 *
 * The first version used `execFileSync`, which blocks the Node event loop for the whole of a
 * Lighthouse run — so Playwright's CDP websocket could not pump, Chrome stopped hearing from the
 * client that owns the profile, and every measurement died with
 * `Protocol error (Page.navigate): Target closed`. Awaiting a child process keeps the loop turning
 * and the connection alive.
 */
const measure = async (route: string): Promise<Measurement> => {
  const out = join(tmpdir(), `lh-${route.replace(/\W/g, '_')}-${String(Date.now())}.json`)
  const args = [
    '--yes', 'lighthouse@12', `${ORIGIN}${route}`,
    `--port=${String(PORT)}`,
    '--preset=perf', '--form-factor=mobile', '--throttling-method=simulate',
    '--screenEmulation.mobile', '--screenEmulation.width=412',
    '--screenEmulation.height=915', '--screenEmulation.deviceScaleFactor=2.6',
    '--only-categories=performance,accessibility,best-practices',
    '--skip-audits=redirects-http,uses-http2,is-on-https',
    '--output=json', `--output-path=${out}`, '--quiet',
  ]

  // stderr surfaced as text rather than swallowed as a Buffer: a lighthouse failure printed as
  // `Uint8Array [ 110, 112, 109 … ]` is a failure nobody can act on.
  try {
    await run('npx', args, { encoding: 'utf8' })
  } catch (error) {
    const shown = error as { stderr?: string; message?: string }
    const detail = String(shown.stderr ?? shown.message ?? error).trim().split('\n').slice(-8).join('\n')
    throw new Error(`lighthouse failed on ${route}:\n${detail}`)
  }

  const report = JSON.parse(readFileSync(out, 'utf8')) as Report
  rmSync(out, { force: true })

  /*
   * The assertion that makes the whole exercise honest. A run that ended on `/sign-in` reports a
   * perfectly good score for a page nobody asked about — which is how the first attempt at this
   * produced numbers that looked fine and meant nothing.
   */
  const landed = new URL(report.finalDisplayedUrl).pathname
  if (landed !== route) {
    throw new Error(`${route} redirected to ${landed} — the session did not survive; numbers discarded`)
  }

  const score = (name: string) => Math.round((report.categories[name]?.score ?? 0) * 100)
  const metric = (name: string) => report.audits[name]?.numericValue ?? 0

  return {
    perf: score('performance'),
    a11y: score('accessibility'),
    bp: score('best-practices'),
    lcp: metric('largest-contentful-paint'),
    cls: metric('cumulative-layout-shift'),
    tbt: metric('total-blocking-time'),
    ttfb: metric('server-response-time'),
    si: metric('speed-index'),
    errors: (report.audits['errors-in-console']?.details?.items ?? []).length,
  }
}

const median = (xs: readonly number[]): number =>
  [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] ?? 0

const profile = mkdtempSync(join(tmpdir(), 'lh-profile-'))
const context = await chromium.launchPersistentContext(profile, {
  args: [`--remote-debugging-port=${String(PORT)}`],
  headless: true,
})

try {
  const page = context.pages()[0] ?? (await context.newPage())
  await seed(context, page)
  console.log(`seeded; measuring ${String(ROUTES.length)} routes × ${String(RUNS)} runs\n`)

  const head = ['route', 'perf', 'a11y', 'bp', 'LCP', 'CLS', 'TBT', 'TTFB', 'SI', 'err']
  console.log(
    (head[0] ?? '').padEnd(14) +
      head.slice(1).map((h) => h.padStart(7)).join(''),
  )

  let worst = 0
  for (const route of ROUTES) {
    const runs: Measurement[] = []
    for (let i = 0; i < RUNS; i += 1) runs.push(await measure(route))
    const m = (k: keyof Measurement): number => median(runs.map((r) => r[k]))
    worst = Math.max(worst, m('lcp'))
    console.log(
      route.padEnd(14) +
        [
          m('perf'), m('a11y'), m('bp'),
          Math.round(m('lcp')), m('cls').toFixed(3),
          Math.round(m('tbt')), Math.round(m('ttfb')), Math.round(m('si')),
          m('errors'),
        ].map((v) => String(v).padStart(7)).join(''),
    )
  }
  console.log(`\nworst median LCP: ${String(Math.round(worst))} ms`)
} finally {
  await context.close()
  rmSync(profile, { recursive: true, force: true })
}
