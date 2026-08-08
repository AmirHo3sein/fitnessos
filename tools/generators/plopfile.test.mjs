import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import nodePlop from 'node-plop'

/**
 * Generator tests — handbook §4.2: "A generator emitting non-compiling code fails CI."
 *
 * Two layers of guarantee, deliberately separated:
 *
 *   here          templates render, no unresolved Handlebars survives, the
 *                 expected file set is complete, and conventions the boundary
 *                 rules depend on actually hold in the output.
 *   `pnpm check`  the generated packages committed to the repo typecheck, lint
 *                 and pass dependency-cruiser.
 *
 * Neither alone is sufficient. Rendering cleanly proves nothing about types;
 * checking the committed output proves nothing about the next generation.
 */

const GENERATORS = path.resolve(import.meta.dirname)
const tmpRoots = []

const generateInto = async (name, tier) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fitnessos-gen-'))
  tmpRoots.push(root)

  // The generator builds ABSOLUTE destinations, which bypass node-plop's own
  // destBasePath. FITNESSOS_GEN_ROOT is the only thing that redirects it — and
  // it must be set before the plopfile is imported, since the base is computed
  // at module load. Without this the tests write into the real workspace.
  process.env['FITNESSOS_GEN_ROOT'] = root
  await fs.mkdir(path.join(root, 'packages/core/src'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'packages/core/src/index.ts'),
    '// <<< contexts >>>\nexport {}\n',
  )

  const plop = await nodePlop(path.join(GENERATORS, 'plopfile.mjs'))
  const generator = plop.getGenerator('context')
  const result = await generator.runActions({ name, tier })

  assert.deepEqual(result.failures, [], `generation reported failures for ${name}`)
  return { root, changes: result.changes }
}

const walk = async (dir, base = dir) => {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, base)))
    else out.push(path.relative(base, full))
  }
  return out.sort()
}

after(async () => {
  await Promise.all(tmpRoots.map((r) => fs.rm(r, { recursive: true, force: true })))
})

describe('gen:context — complex tier', () => {
  it('emits the file set the handbook specifies', async () => {
    const { root } = await generateInto('prescription', 'complex')
    const pkg = path.join(root, 'packages/ctx-prescription')
    const files = await walk(pkg)

    for (const expected of [
      'README.md',
      'eslint.config.js',
      'package.json',
      'tsconfig.json',
      'vitest.config.ts',
      'src/index.ts',
      'src/domain/index.ts',
      'src/application/index.ts',
      'src/application/ports/index.ts',
      'src/application/events/index.ts',
      'src/application/queries/prescriptionKeys.ts',
      'src/presentation/index.ts',
    ]) {
      assert.ok(files.includes(expected), `missing ${expected}\ngot:\n${files.join('\n')}`)
    }
  })

  it('leaves no unresolved Handlebars in any rendered file', async () => {
    const { root } = await generateInto('nutrition', 'complex')
    const pkg = path.join(root, 'packages/ctx-nutrition')
    for (const rel of await walk(pkg)) {
      if (rel.endsWith('.gitkeep')) continue
      const body = await fs.readFile(path.join(pkg, rel), 'utf8')
      assert.ok(!body.includes('{{'), `unresolved template expression in ${rel}`)
      assert.ok(!rel.includes('{{'), `unresolved template expression in filename ${rel}`)
    }
  })

  it('names the query-key file in camelCase from a kebab-case context', async () => {
    const { root } = await generateInto('body-composition', 'complex')
    const files = await walk(path.join(root, 'packages/ctx-body-composition'))
    assert.ok(files.includes('src/application/queries/bodyCompositionKeys.ts'))
  })

  it('does not re-export presentation from the package barrel', async () => {
    // If it did, importing the barrel from a framework-free layer would pull
    // React in transitively and quietly defeat `no-react-in-logic`.
    const { root } = await generateInto('report', 'complex')
    const barrel = await fs.readFile(
      path.join(root, 'packages/ctx-report/src/index.ts'),
      'utf8',
    )
    assert.ok(!barrel.includes("from './presentation"), 'barrel must not export presentation')

    const pkg = JSON.parse(
      await fs.readFile(path.join(root, 'packages/ctx-report/package.json'), 'utf8'),
    )
    assert.equal(pkg.exports['./presentation'], './src/presentation/index.ts')
  })

  it('declares no dependency on another bounded context', async () => {
    const { root } = await generateInto('timeline', 'complex')
    const pkg = JSON.parse(
      await fs.readFile(path.join(root, 'packages/ctx-timeline/package.json'), 'utf8'),
    )
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    assert.deepEqual(
      deps.filter((d) => d.startsWith('@fitnessos/ctx-')),
      [],
      'a generated context must not depend on another context',
    )
  })

  it('imports no framework into application or domain', async () => {
    const { root } = await generateInto('workflow', 'complex')
    const pkg = path.join(root, 'packages/ctx-workflow')
    const banned = /from ['"](react|react-dom|next|@tanstack\/react-query)/
    for (const rel of await walk(pkg)) {
      if (!rel.startsWith('src/domain') && !rel.startsWith('src/application')) continue
      const body = await fs.readFile(path.join(pkg, rel), 'utf8')
      assert.ok(!banned.test(body), `framework import in ${rel}`)
    }
  })
})

describe('gen:context — core tier', () => {
  it('emits a folder, not a package', async () => {
    const { root } = await generateInto('affiliation', 'core')
    const dir = path.join(root, 'packages/core/src/affiliation')
    const files = await walk(dir)

    assert.ok(files.includes('index.ts'))
    assert.ok(files.includes('domain/index.ts'))
    assert.ok(files.includes('application/queries/affiliationKeys.ts'))
    assert.ok(!files.includes('package.json'), 'core-tier contexts are folders, not packages')
    assert.ok(!files.includes('tsconfig.json'))
  })
})
