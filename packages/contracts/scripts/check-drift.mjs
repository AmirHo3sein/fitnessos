#!/usr/bin/env node
/**
 * Contract drift check — CI stage 2.
 *
 * Regenerates both artefacts and fails if either differs from what is committed.
 *
 * Deliberately does NOT use `git diff --exit-code`, which was the first
 * implementation and was **vacuous**: git reports no change for an untracked file, so
 * before these files were first committed the check passed while comparing nothing.
 * It would have worked in CI, where checkout tracks everything, and quietly passed for
 * everyone running it locally — the worst division of labour, since the local run is
 * the one meant to catch this before the push.
 *
 * Comparing content directly depends on nothing outside this script.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(here, '..')

const ARTEFACTS = ['src/api.gen.ts', 'src/schemas.gen.ts']

const read = (p) => {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

const before = new Map(ARTEFACTS.map((f) => [f, read(join(pkgRoot, f))]))

execFileSync('pnpm', ['run', 'contracts:generate'], { cwd: pkgRoot, stdio: 'inherit' })

const drifted = []
for (const f of ARTEFACTS) {
  const after = read(join(pkgRoot, f))
  if (after === null) {
    drifted.push(`${f} was not produced by contracts:generate`)
    continue
  }
  if (before.get(f) === null) {
    drifted.push(`${f} did not exist before generation — commit the generated artefact`)
    continue
  }
  if (before.get(f) !== after) {
    // Leave the regenerated content in place: it is what should be committed, so the
    // fix is `git add`, not "run the generator again".
    drifted.push(`${f} is out of date with spec/openapi.json`)
  }
}

if (drifted.length > 0) {
  console.error('\n✖ contract artefacts are out of date:\n')
  for (const d of drifted) console.error(`  - ${d}`)
  console.error(
    '\n  The spec changed without the generated artefacts being regenerated and\n' +
      '  committed. The regenerated files are now on disk — review and commit them.\n' +
      `  Files: ${ARTEFACTS.map((f) => relative(process.cwd(), join(pkgRoot, f))).join(', ')}\n`,
  )
  process.exit(1)
}

console.log('✔ contract artefacts match spec/openapi.json')
