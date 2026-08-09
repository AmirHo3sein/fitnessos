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
 * What a cold visitor to any single URL may download.
 *
 * Deliberately one number for every route rather than a table: this is a statement about the
 * slowest connection in the product, and it does not get more generous because a page is
 * complicated. Measured worst case today is the sign-in screen.
 */
const FIRST_LOAD_BUDGET_KB = 175

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
 *
 * ## These numbers were re-baselined once the accounting was fixed
 *
 * They used to be four to nine times larger, because a chunk shared by every authenticated
 * route was billed to each of them in full — React Aria alone was counted six times. Three
 * routes appeared to be one kilobyte from their ceiling and were not, and the appearance nearly
 * bought a restructuring of the contracts package to fix an arithmetic mistake.
 *
 * The budgets below are against EXCLUSIVE size — code no other route uses. They are set close
 * to the measured values on purpose: a budget nothing can hit is decoration, and the two real
 * leaks this file has caught (an aggregate barrel, and packages missing `sideEffects: false`)
 * would both have shown up here as well as in first load.
 */
const ROUTE_BUDGETS_KB = [
  // The authenticated shell. Measured 9.6 kB exclusive.
  [/^\/\[locale\]\/\(app\)\/layout$/, 20],

  // Marketing and other unauthenticated content. Measured 1.3 kB exclusive — it is a link and
  // some text, and it should stay in that region. The tightest budget here for the same reason
  // as before: it is where accidental weight is least likely to be noticed by anyone working on
  // the app itself.
  [/^\/\[locale\]\/\(public\)\//, 5],

  // Sign-in. Measured 4.9 kB exclusive — the client stack it pays for (Zod, React Aria, TanStack
  // Query) is shared with every subsequent screen, which is exactly what the old accounting
  // could not see.
  [/^\/\[locale\]\/\(auth\)\//, 12],

  // The root layout — QueryClient boundary only, no ports. Measured 13.5 kB exclusive.
  [/^\/\[locale\]\/layout$/, 20],

  // Individual pages inside the authenticated area. Measured 0.2–6.6 kB exclusive, so 15 leaves
  // room for a genuinely heavier page while still catching an order-of-magnitude regression.
  [/./, 15],
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
/*
 * Two numbers per route, because one of them was lying.
 *
 * `shared` above is only `rootMainFiles` — the framework runtime. A chunk used by every
 * authenticated route but not by the marketing page is in none of the route's "shared" sets, so
 * the original accounting billed it to each route in full. React Aria (18.1 kB gz) was being
 * counted six times, which is how sign-in came to report 54.5 kB "of its own JS" when 18 of
 * those are downloaded once and reused everywhere.
 *
 * That is not a cosmetic error. It made three routes look one kilobyte from their ceiling and
 * nearly bought a restructuring of the contracts package to solve a problem that was an
 * arithmetic mistake. So:
 *
 *   exclusive  files this route uses and NO other route does. The true marginal cost of the
 *              route existing, and what a budget should gate on.
 *   first load what a cold visitor to this URL downloads: framework + everything the route
 *              needs, shared or not. The number that matters to a person, gated more loosely
 *              because most of it is amortised across the session.
 */
const usage = new Map()
for (const files of Object.values(appManifest.pages ?? {})) {
  for (const file of new Set(files)) usage.set(file, (usage.get(file) ?? 0) + 1)
}

for (const [route, files] of Object.entries(appManifest.pages ?? {})) {
  const exclusive = files.filter((f) => !shared.has(f) && usage.get(f) === 1)
  const exclusiveKb = kb(sizeOf(exclusive))
  const firstLoadKb = kb(sizeOf(new Set([...shared, ...files])))

  const budget = budgetFor(route)
  console.log(
    `${exclusiveKb <= budget ? '✔' : '✖'} ${route.padEnd(32)} ${String(exclusiveKb).padStart(6)} kB gz exclusive  ` +
      `(budget ${budget})   ${String(firstLoadKb).padStart(6)} kB first load`,
  )

  if (exclusiveKb > budget) {
    fail(
      `route ${route} ships ${exclusiveKb} kB of JS NO other route uses, over its ${budget} kB ` +
        'budget. This is code only this page needs, so a dynamic import is usually the answer. ' +
        'If it is a public or auth route, check whether infrastructure has leaked across a ' +
        'composition boundary before reaching for the budget number.',
    )
  }

  if (firstLoadKb > FIRST_LOAD_BUDGET_KB) {
    fail(
      `route ${route} costs a cold visitor ${firstLoadKb} kB, over the ${FIRST_LOAD_BUDGET_KB} kB ` +
        'first-load budget. Most of this is shared, so the fix is usually in what the route ' +
        'GROUP mounts rather than in the page itself.',
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
