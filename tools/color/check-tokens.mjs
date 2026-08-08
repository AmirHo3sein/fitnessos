#!/usr/bin/env node
/**
 * Fails if the committed token files are stale.
 *
 * Same discipline as the contract-drift check, and NOT `git diff` — git reports no change for a
 * file that is untracked, so a git-based check passes while comparing nothing. Content is
 * compared directly.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const files = ['packages/design-tokens/src/tokens.css', 'packages/design-tokens/src/generated.ts']

const read = (f) => {
  try {
    return readFileSync(resolve(root, f), 'utf8')
  } catch {
    return null
  }
}

const before = new Map(files.map((f) => [f, read(f)]))
execFileSync('node', [resolve(root, 'tools/color/emit.mjs')], { stdio: 'inherit' })

const stale = files.filter((f) => before.get(f) !== read(f))

if (stale.length > 0) {
  console.error(`\n✖ design tokens are out of date:\n`)
  for (const f of stale) console.error(`  - ${f}`)
  console.error(
    '\n  A colour changed in tools/color/ without the generated tokens being rebuilt and\n' +
      '  committed. They have been regenerated on disk — review and commit them.\n',
  )
  process.exit(1)
}
console.log('✔ design tokens match tools/color/')
