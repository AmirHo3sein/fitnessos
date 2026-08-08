#!/usr/bin/env node
/**
 * Bundle budget — CI stage 9.
 *
 * Reads the build manifests that `next build` already produces, so there is no
 * second build and no bundler plugin to keep in step with the framework.
 *
 * Why a budget at all: bundle size regresses one dependency at a time, and each
 * addition looks reasonable in isolation. The primary market is mobile Iran, where
 * the difference between 150 kB and 400 kB of shared JS is measured in seconds on
 * first load. A number in CI is the only thing that turns "we should keep an eye on
 * that" into a decision someone has to make.
 *
 * Budgets are deliberately close to current usage, not comfortably above it. A
 * budget with 200 kB of headroom does not fail until the damage is done; the point
 * is to make an increase visible while it is still one commit.
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nextDir = join(repoRoot, 'apps/web/.next')

/**
 * All figures are GZIPPED, because that is what crosses the wire. Raw byte counts
 * are roughly 3.4× larger here and would make every budget an arbitrary number
 * with no relationship to what a user waits for.
 *
 * Each budget is current measured size plus a small deliberate margin. Generous
 * headroom defeats the purpose: a budget only does work if it fails while the
 * increase is still one reviewable commit.
 */
/**
 * Shared by every route, so the number that matters most.
 * Measured 99.8 kB: React, React DOM, the Next runtime, TanStack Query.
 */
const SHARED_BUDGET_KB = 110

/**
 * Edge middleware runs on every matched request, so weight here is paid on every
 * navigation rather than once. Measured 43.6 kB, nearly all of it next-intl's locale
 * negotiation. If this grows, the question to ask is whether the routing table can be
 * resolved without the full library.
 */
const MIDDLEWARE_BUDGET_KB = 50

/**
 * Per-route budgets, first match wins.
 *
 * Deliberately not one number for every route. A marketing page and an authenticated
 * application shell have different jobs, and a single limit generous enough for the
 * second says nothing useful about the first — 20 kB of accidental weight on the
 * landing page would sit comfortably inside a 65 kB budget and never be noticed.
 *
 * The tight budgets are the ones doing the work here. `(public)` and `(auth)` are
 * reached before a visitor has committed anything, often on a slow mobile connection,
 * and they need no infrastructure at all. If either starts approaching its budget,
 * something has leaked across the composition boundary — which is exactly how this
 * split came about: response validation put Zod into the ROOT layout chunk, because
 * the container was constructed there, so every visitor to the landing page downloaded
 * a validator for an endpoint they would never call. The fix was to move port
 * providers into the route group that uses them; the budget is what surfaced it.
 */
const ROUTE_BUDGETS_KB = [
  // The authenticated shell: container, infra, generated validators, React Aria,
  // next-intl's client runtime. Loaded once and navigated within. Measured 59.6 kB.
  [/^\/\[locale\]\/\(app\)\/layout$/, 65],
  // Everything a visitor sees before signing in. No infrastructure belongs here.
  [/^\/\[locale\]\/\((public|auth)\)\//, 30],
  // The root layout — QueryClient boundary only, no container. Measured 15.2 kB.
  [/^\/\[locale\]\/layout$/, 25],
  // Individual pages inside the authenticated area.
  [/./, 45],
]

const budgetFor = (route) => ROUTE_BUDGETS_KB.find(([pattern]) => pattern.test(route))?.[1] ?? 45

const fail = (message) => {
  console.error(`✖ ${message}`)
  process.exitCode = 1
}

if (!existsSync(nextDir)) {
  fail('apps/web/.next not found — run `pnpm --filter @fitnessos/web build` first.')
  process.exit(1)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10

/**
 * Gzip each file individually and sum, rather than gzipping the concatenation.
 * Files are fetched as separate responses, so each is compressed on its own —
 * concatenating first would let one file's dictionary compress another's and report
 * a size no user ever benefits from.
 */
const sizeOf = (files) => {
  let total = 0
  for (const file of files) {
    const path = join(nextDir, file)
    if (existsSync(path)) total += gzipSync(readFileSync(path), { level: 9 }).byteLength
  }
  return total
}

const manifest = readJson(join(nextDir, 'build-manifest.json'))
const appManifest = readJson(join(nextDir, 'app-build-manifest.json'))

// --- shared ------------------------------------------------------------------
const shared = new Set(manifest.rootMainFiles ?? [])
const sharedKb = kb(sizeOf(shared))
const label = (name, value, budget) =>
  `${value <= budget ? '✔' : '✖'} ${name.padEnd(32)} ${String(value).padStart(6)} kB gz  (budget ${budget} kB)`

console.log(label('shared first load', sharedKb, SHARED_BUDGET_KB))
if (sharedKb > SHARED_BUDGET_KB) {
  fail(
    `shared first-load JS is ${sharedKb} kB, over the ${SHARED_BUDGET_KB} kB budget. ` +
      'Either move the addition behind a dynamic import, or raise the budget in this ' +
      'file with a note saying what it bought.',
  )
}

// --- per route ---------------------------------------------------------------
for (const [route, files] of Object.entries(appManifest.pages ?? {})) {
  const own = files.filter((f) => !shared.has(f))
  const routeKb = kb(sizeOf(own))
  const budget = budgetFor(route)
  console.log(label(route, routeKb, budget))
  if (routeKb > budget) {
    fail(
      `route ${route} ships ${routeKb} kB of its own JS, over its ${budget} kB budget. ` +
        'If this is a public or auth route, infrastructure has probably leaked across a ' +
        'composition boundary — check which providers the route group mounts before ' +
        'reaching for the budget number.',
    )
  }
}

// --- middleware --------------------------------------------------------------
// Not in the manifests above; read from the compiled edge artefact.
const middlewarePath = join(nextDir, 'server/middleware.js')
if (existsSync(middlewarePath)) {
  const middlewareKb = kb(gzipSync(readFileSync(middlewarePath), { level: 9 }).byteLength)
  console.log(label('middleware', middlewareKb, MIDDLEWARE_BUDGET_KB))
  if (middlewareKb > MIDDLEWARE_BUDGET_KB) {
    fail(
      `middleware is ${middlewareKb} kB, over the ${MIDDLEWARE_BUDGET_KB} kB budget. It runs on ` +
        'every matched request, so weight here is paid on every navigation.',
    )
  }
}

if (process.exitCode) {
  console.error('\nBundle budget exceeded. See tools/bundle-budget.mjs for the rationale.')
} else {
  console.log('\n✔ all bundle budgets met')
}
