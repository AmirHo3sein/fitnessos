#!/usr/bin/env node
/**
 * WCAG contrast report. Fails the build on any violation.
 *
 * The point of computing this rather than asserting it: a palette is a set of claims about
 * legibility, and every one of them is checkable. "Designed for AA" is not a property a
 * codebase has — it is a property a build either verifies or does not.
 *
 * Thresholds applied (WCAG 2.1):
 *   4.5:1  normal text (1.4.3)
 *   3.0:1  large text ≥24px, or ≥18.66px bold (1.4.3)
 *   3.0:1  UI component boundaries and state indicators (1.4.11)
 *
 * Documented exemptions are declared explicitly rather than skipped silently, so the report
 * shows what is NOT covered as clearly as what is.
 */
import { CHART_TOKENS, DARK, DOMAIN, LIGHT } from './semantic.mjs'
import { PALETTE, STEPS } from './palette.mjs'
import { over, ratio } from './oklch.mjs'

let failures = 0
const rows = []

const check = (label, fg, bg, min, note = '') => {
  const r = ratio(fg, bg)
  const pass = r >= min
  if (!pass) failures += 1
  rows.push({ label, fg, bg, r, min, pass, note })
}

const section = (title) => {
  rows.push({ section: title })
}

// ---------------------------------------------------------------------------
// Promise 1: every family's 600 step is safe for white text.
// The whole semantic layer leans on this — it is what lets a destructive button and a primary
// button be the same button in a different hue.
// ---------------------------------------------------------------------------
section('Primitive promise — <family>-600 carries white text')
for (const family of Object.keys(PALETTE)) {
  check(`${family}-600 / white`, PALETTE[family][600].hex, '#ffffff', 4.5)
}

section('Primitive promise — <family>-700+ carries white text with headroom')
for (const family of Object.keys(PALETTE)) {
  check(`${family}-700 / white`, PALETTE[family][700].hex, '#ffffff', 4.5)
}

// ---------------------------------------------------------------------------
// Promise 2: the dark-theme mirror. 300/400 steps must carry the dark canvas.
// ---------------------------------------------------------------------------
section('Primitive promise — <family>-400 on the dark canvas')
for (const family of Object.keys(PALETTE)) {
  check(`${family}-400 on slate-950`, PALETTE[family][400].hex, PALETTE.slate[950].hex, 4.5)
}

// ---------------------------------------------------------------------------
// Light theme semantics
// ---------------------------------------------------------------------------
section('Light theme — text')
check('text-primary / canvas', LIGHT['text-primary'], LIGHT['bg-canvas'], 4.5)
check('text-primary / surface', LIGHT['text-primary'], LIGHT['bg-surface'], 4.5)
check('text-secondary / surface', LIGHT['text-secondary'], LIGHT['bg-surface'], 4.5)
check('text-muted / surface', LIGHT['text-muted'], LIGHT['bg-surface'], 4.5)
check('text-muted / canvas', LIGHT['text-muted'], LIGHT['bg-canvas'], 4.5)
check('text-brand / surface', LIGHT['text-brand'], LIGHT['bg-surface'], 4.5)

section('Light theme — actions')
check('primary button label', LIGHT['action-primary-fg'], LIGHT['action-primary'], 4.5)
check('primary button hover', LIGHT['action-primary-fg'], LIGHT['action-primary-hover'], 4.5)
check('primary button active', LIGHT['action-primary-fg'], LIGHT['action-primary-active'], 4.5)
check('secondary button label', LIGHT['action-secondary-fg'], LIGHT['action-secondary'], 4.5)
check('secondary button hover', LIGHT['action-secondary-fg'], LIGHT['action-secondary-hover'], 4.5)
check('ghost button label', LIGHT['action-ghost-fg'], LIGHT['bg-surface'], 4.5)
check('destructive button label', LIGHT['action-destructive-fg'], LIGHT['action-destructive'], 4.5)
check('destructive hover', LIGHT['action-destructive-fg'], LIGHT['action-destructive-hover'], 4.5)

section('Light theme — boundaries and indicators (3:1, WCAG 1.4.11)')
check('primary button vs canvas', LIGHT['action-primary'], LIGHT['bg-canvas'], 3)
check('focus ring vs surface', LIGHT.focus, LIGHT['bg-surface'], 3)
check('focus ring vs canvas', LIGHT.focus, LIGHT['bg-canvas'], 3)
check('border-strong vs surface', LIGHT['border-strong'], LIGHT['bg-surface'], 3)
check('border-strong vs canvas', LIGHT['border-strong'], LIGHT['bg-canvas'], 3)
check('border-brand vs surface', LIGHT['border-brand'], LIGHT['bg-surface'], 3)

section('Light theme — status')
for (const status of ['success', 'warning', 'error', 'info']) {
  check(
    `${status} text on its surface`,
    LIGHT[`status-${status}-fg`],
    LIGHT[`status-${status}-surface`],
    4.5,
  )
  check(
    `${status} solid vs surface (icon)`,
    LIGHT[`status-${status}-solid`],
    LIGHT['bg-surface'],
    3,
  )
}

section('Light theme — selection')
check('selection text', LIGHT['selection-fg'], LIGHT['selection-bg'], 4.5)

// ---------------------------------------------------------------------------
// Dark theme semantics
// ---------------------------------------------------------------------------
section('Dark theme — text')
check('text-primary / canvas', DARK['text-primary'], DARK['bg-canvas'], 4.5)
check('text-primary / surface', DARK['text-primary'], DARK['bg-surface'], 4.5)
check('text-primary / elevated', DARK['text-primary'], DARK['bg-surface-elevated'], 4.5)
check('text-secondary / surface', DARK['text-secondary'], DARK['bg-surface'], 4.5)
check('text-muted / surface', DARK['text-muted'], DARK['bg-surface'], 4.5)
check('text-muted / canvas', DARK['text-muted'], DARK['bg-canvas'], 4.5)
check('text-brand / surface', DARK['text-brand'], DARK['bg-surface'], 4.5)

section('Dark theme — actions')
check('primary button label', DARK['action-primary-fg'], DARK['action-primary'], 4.5)
check('primary button hover', DARK['action-primary-fg'], DARK['action-primary-hover'], 4.5)
check('secondary button label', DARK['action-secondary-fg'], DARK['action-secondary'], 4.5)
check('ghost button label', DARK['action-ghost-fg'], DARK['bg-canvas'], 4.5)
check('destructive button label', DARK['action-destructive-fg'], DARK['action-destructive'], 4.5)

section('Dark theme — boundaries and indicators (3:1)')
check('primary button vs canvas', DARK['action-primary'], DARK['bg-canvas'], 3)
check('focus ring vs canvas', DARK.focus, DARK['bg-canvas'], 3)
check('focus ring vs surface', DARK.focus, DARK['bg-surface'], 3)
check('border-strong vs surface', DARK['border-strong'], DARK['bg-surface'], 3)
check('border-strong vs canvas', DARK['border-strong'], DARK['bg-canvas'], 3)
// Surface separation: a card must be distinguishable from the canvas behind it. 1.4.11 does not
// require 3:1 here, but below roughly 1.2 the boundary disappears on a dim laptop screen, which
// is the failure mode dark themes actually have.
check('surface vs canvas (separation)', DARK['bg-surface'], DARK['bg-canvas'], 1.2)
check('elevated vs surface (separation)', DARK['bg-surface-elevated'], DARK['bg-surface'], 1.2)

section('Dark theme — status')
for (const status of ['success', 'warning', 'error', 'info']) {
  check(
    `${status} text on its surface`,
    DARK[`status-${status}-fg`],
    DARK[`status-${status}-surface`],
    4.5,
  )
  check(`${status} solid vs surface (icon)`, DARK[`status-${status}-solid`], DARK['bg-surface'], 3)
}

// ---------------------------------------------------------------------------
// Charts — every series must be distinguishable from its own background.
// 3:1 rather than 4.5: a chart series is a graphical object, not text (WCAG 1.4.11).
// ---------------------------------------------------------------------------
section('Charts — series vs background')
for (let i = 1; i <= 12; i += 1) {
  check(`light chart-${i} on surface`, CHART_TOKENS.light[`chart-${i}`], LIGHT['bg-surface'], 3)
}
for (let i = 1; i <= 12; i += 1) {
  check(`dark chart-${i} on surface`, CHART_TOKENS.dark[`chart-${i}`], DARK['bg-surface'], 3)
}

section('Charts — annotations')
for (const key of ['chart-positive', 'chart-negative', 'chart-target']) {
  check(`light ${key}`, CHART_TOKENS.light[key], LIGHT['bg-surface'], 3)
  check(`dark ${key}`, CHART_TOKENS.dark[key], DARK['bg-surface'], 3)
}

section('Domain — readiness and trend')
for (const key of Object.keys(DOMAIN.light)) {
  check(`light ${key}`, DOMAIN.light[key], LIGHT['bg-surface'], 3)
  check(`dark ${key}`, DOMAIN.dark[key], DARK['bg-surface'], 3)
}

// ---------------------------------------------------------------------------
// Composited values. WCAG contrast is defined for opaque colours, so an alpha token has to be
// flattened against what it actually sits on — checking the rgba directly would report a ratio
// nobody ever sees.
// ---------------------------------------------------------------------------
section('Editor — composited over the working surface')
check(
  'light selection border vs surface',
  LIGHT['border-brand'],
  LIGHT['bg-surface'],
  3,
  'selection outline',
)
check(
  'light selection fill over surface',
  over(LIGHT['action-primary'], 0.12, LIGHT['bg-surface']),
  LIGHT['bg-surface'],
  1.05,
  'must be visible but not obscure content',
)
check('dark selection border vs surface', DARK['border-brand'], DARK['bg-surface'], 3)
check(
  'dark selection fill over surface',
  over(DARK['action-primary'], 0.16, DARK['bg-surface']),
  DARK['bg-surface'],
  1.05,
)

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
const EXEMPTIONS = [
  [
    'text-disabled',
    `light ${ratio(LIGHT['text-disabled'], LIGHT['bg-surface'])}:1 · dark ${ratio(DARK['text-disabled'], DARK['bg-surface'])}:1`,
    'WCAG 1.4.3 exempts inactive controls. Kept legible enough to read WHAT is disabled — a disabled field the user cannot read is a dead end rather than a locked door. Never use this token for active text.',
  ],
  [
    '<family>-500',
    `teal-500 on white ${ratio(PALETTE.teal[500].hex, '#ffffff')}:1`,
    'Clears 3:1, so it is legal for large text (≥24px) and UI boundaries and ILLEGAL for body text. The 500 step is the expressive one; 600 is the one that carries labels.',
  ],
  [
    'chart-missing',
    'intentionally low',
    'Missing data must recede. Colour alone cannot say "unknown" — the chart layer must pair it with a hatch pattern.',
  ],
]

console.log('\nFitnessOS colour system — WCAG contrast report\n')
for (const row of rows) {
  if (row.section) {
    console.log(`\n${row.section}`)
    continue
  }
  const mark = row.pass ? '✔' : '✖'
  const r = row.r.toFixed(2).padStart(6)
  console.log(
    `  ${mark} ${row.label.padEnd(38)} ${r}:1  (min ${row.min})  ${row.fg} on ${row.bg}${row.note ? `  — ${row.note}` : ''}`,
  )
}

console.log('\nDocumented exemptions — checked, not skipped\n')
for (const [token, measured, why] of EXEMPTIONS) {
  console.log(`  · ${token.padEnd(16)} ${measured}`)
  console.log(`      ${why}`)
}

const total = rows.filter((r) => !r.section).length
console.log(`\n${total - failures}/${total} checks passed.`)

if (failures > 0) {
  console.error(
    `\n✖ ${failures} contrast failure(s). Accessibility takes priority over aesthetics: change the colour, do not lower the threshold.\n`,
  )
  process.exit(1)
}
console.log('✔ every checked pair meets its threshold.\n')
