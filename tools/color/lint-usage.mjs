#!/usr/bin/env node
/**
 * Enforces the level boundary: components use SEMANTIC tokens, never primitives or literals.
 *
 * The whole three-level architecture rests on this one rule, and it is the rule a design system
 * loses first — not deliberately, but because `bg-teal-600` works, renders correctly, and looks
 * indistinguishable from `bg-action` in review. It is only wrong later, when the brand changes
 * and half the product does not.
 *
 * dependency-cruiser cannot see this: it is a string inside a className, not an import. So it is
 * checked here, at the same severity, with the same no-waiver policy.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const ROOTS = [
  'packages/ui/src',
  'packages/core/src',
  'packages/ctx-prescription/src',
  'apps/web/app',
  'apps/web/composition',
]

const FAMILIES = 'teal|slate|green|amber|red|blue'
const RULES = [
  {
    // `bg-teal-600`, `text-slate-400`, `border-red-500` … a Tailwind utility naming a PRIMITIVE.
    pattern: new RegExp(`\\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:${FAMILIES})-\\d{2,3}\\b`, 'g'),
    message: 'names a palette primitive. Use a semantic token (bg-surface, text-primary, …).',
  },
  {
    // A raw hex in a className or style. Bypasses the system entirely.
    pattern: /#[0-9a-fA-F]{3,8}\b/g,
    message: 'is a colour literal. Every colour must come from a semantic token.',
    // Generated files and the token pipeline itself are where hex legitimately lives.
    skipFile: (f) => f.includes('generated') || f.includes('design-tokens'),
  },
  {
    /*
     * `text-disabled` at 2.14:1 is exempt from WCAG 1.4.3 only because 1.4.3 exempts INACTIVE
     * controls. On anything else it is simply text below the contrast threshold.
     *
     * Its own documentation said "never use this token for active text" and every one of the
     * eight uses in this codebase was active text — form hints, empty-state copy, a
     * withheld-basis note. Found by an axe audit, not by review, because a hint rendered in pale
     * grey looks intentional.
     *
     * So the rule is mechanical now: components may not name it at all. A genuinely disabled
     * control reaches the same colour through `action-disabled-fg`, which is what the Button
     * primitive uses, and which carries the state that makes the exemption apply.
     */
    pattern: /\btext-disabled\b/g,
    message:
      'uses text-disabled (2.14:1) as active text. WCAG 1.4.3 exempts inactive CONTROLS only — use text-muted, or action-disabled-fg on a genuinely disabled control.',
    skipFile: (f) => f.includes('theme.css'),
  },
]

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

let violations = 0
for (const base of ROOTS) {
  const dir = resolve(root, base)
  let files
  try {
    files = walk(dir)
  } catch {
    continue
  }
  for (const file of files) {
    const rel = relative(root, file)
    const source = readFileSync(file, 'utf8')
    for (const rule of RULES) {
      if (rule.skipFile?.(rel)) continue
      for (const match of source.matchAll(rule.pattern)) {
        const line = source.slice(0, match.index).split('\n').length
        console.error(`✖ ${rel}:${line}  \`${match[0]}\` ${rule.message}`)
        violations += 1
      }
    }
  }
}

if (violations > 0) {
  console.error(
    `\n${violations} token violation(s).\n\n` +
      '  The chain is: component → semantic token → primitive → theme.\n' +
      '  A component naming a primitive has skipped a link, and the brand cannot be\n' +
      '  changed without finding it. If no semantic token fits, add one — that is a\n' +
      '  reviewable edit to semantic.mjs, which is the point.\n',
  )
  process.exit(1)
}
console.log('✔ no component references a palette primitive or a colour literal')
