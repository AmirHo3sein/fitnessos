/**
 * Persian register consistency — a ratchet, not a style opinion.
 *
 * Persian distinguishes an informal second person (تو: «تلاش کن») from a formal one (شما: «تلاش
 * کنید»). Mixing them inside one screen is jarring in a way an English speaker will not see in
 * review, and this codebase does mix them: an athlete on the sessions screen reads «جلسه‌ای در پیش
 * نداری» (informal) and, if a save fails, «تغییرات شما ذخیره نشد» (formal).
 *
 * ## What this does NOT do
 *
 * It does not choose. Which register the product speaks is a product decision that belongs to
 * somebody who speaks Persian — informal is common in Iranian fitness apps and formal is safer for a
 * coach-facing tool, and that is not a call to make from a regex.
 *
 * So `register.json` records the intended register per section. Sections marked `undecided` are
 * REPORTED and do not fail: the existing mixture is a known open question, not a regression. A
 * section marked `formal` or `informal` fails if it contains the other, and a section with no entry
 * at all fails too — which is what stops new drift while the question is open.
 *
 * The value is turning "review 339 strings" into "answer one question, then fix the listed few".
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../..')

/**
 * Word-boundary-aware markers.
 *
 * The boundaries are not decoration. A first version matched `کن` anywhere and flagged «کنار»
 * (aside) and «خودتنظیم» (self-regulating) as informal — three false positives out of eleven hits,
 * which is enough to make a checker worse than nothing. Persian letters are the boundary class.
 */
const P = '؀-ۿ'
const bounded = (words) =>
  new RegExp(`(?<![${P}])(${words.join('|')})(?![${P}])`, 'u')

const FORMAL = bounded([
  'کنید',
  'بگذارید',
  'بنویسید',
  'بزنید',
  'بگیرید',
  'شوید',
  'دارید',
  'ندارید',
  'شما',
])

const INFORMAL = bounded([
  'کن',
  'بگذار',
  'بنویس',
  'بزن',
  'بگیر',
  'داری',
  'نداری',
  'خودت',
  'هدفت',
])

const flatten = (object, path = '', into = []) => {
  for (const [key, value] of Object.entries(object)) {
    const next = path === '' ? key : `${path}.${key}`
    if (typeof value === 'string') into.push([next, value])
    else if (value !== null && typeof value === 'object') flatten(value, next, into)
  }
  return into
}

const messages = JSON.parse(readFileSync(join(repo, 'apps/web/messages/fa.json'), 'utf8'))
const declared = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'))

const strings = flatten(messages)
const sections = new Map()

for (const [path, value] of strings) {
  const section = path.split('.')[0]
  if (!sections.has(section)) sections.set(section, { formal: [], informal: [] })
  const bucket = sections.get(section)
  if (FORMAL.test(value)) bucket.formal.push([path, value])
  if (INFORMAL.test(value)) bucket.informal.push([path, value])
}

const problems = []
const reports = []

for (const [section, { formal, informal }] of [...sections].sort()) {
  const intent = declared.sections[section]

  if (intent === undefined) {
    problems.push(
      `${section}: no register declared. Add it to tools/copy/register.json — "formal", "informal", or "undecided" with a reason.`,
    )
    continue
  }

  if (intent === 'undecided') {
    if (formal.length > 0 && informal.length > 0) {
      reports.push(
        `${section}: mixed (${String(formal.length)} formal, ${String(informal.length)} informal) — awaiting a decision`,
      )
    }
    continue
  }

  const wrong = intent === 'formal' ? informal : formal
  for (const [path, value] of wrong) {
    problems.push(`${section} is declared ${intent} but ${path} is not: "${value}"`)
  }
}

if (reports.length > 0) {
  console.log('Persian register — sections awaiting a decision (not a failure):')
  for (const line of reports) console.log(`  · ${line}`)
  console.log(
    '\n  Deciding one question fixes these. The listed strings are in apps/web/messages/fa.json.',
  )
}

if (problems.length > 0) {
  console.error('\n✖ Persian register problems:')
  for (const line of problems) console.error(`  ✖ ${line}`)
  process.exitCode = 1
} else {
  console.log(`\n✔ Persian register: ${String(strings.length)} strings, no declared section violated`)
}
