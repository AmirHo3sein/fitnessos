#!/usr/bin/env node
/**
 * spec/openapi.json → src/schemas.gen.ts
 *
 * Emits a runtime Zod schema per component schema, alongside the compile-time types
 * `openapi-typescript` produces from the same file. One spec, two artefacts, no
 * hand-written duplication (ADR-0029, ADR-0031).
 *
 * Two properties of this generator are load-bearing:
 *
 * 1. **It refuses to emit rather than degrade.** `json-schema-to-zod` returns
 *    `z.any()` for anything it cannot interpret — including an unresolved `$ref`.
 *    A validator that silently accepts everything is worse than no validator,
 *    because it reads as coverage in review and in CI. Any `z.any()`/`z.unknown()`
 *    in the output aborts the build, naming the schema.
 *
 * 2. **Schemas are NOT `.strict()`.** Unknown keys are stripped, not rejected, so a
 *    backend adding a field cannot break the frontend. Tolerant reader, strict
 *    writer. What is *not* tolerated is a missing required field or a wrong type —
 *    which is the whole set of changes that would otherwise corrupt data silently.
 *
 * OpenAPI 3.1 is required, and asserted below: its schemas are JSON Schema 2020-12,
 * which is what makes this a direct translation. A 3.0 spec uses `nullable: true`
 * rather than a null type union and would translate incorrectly — silently.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { jsonSchemaToZod } from 'json-schema-to-zod'

const here = dirname(fileURLToPath(import.meta.url))
const specPath = resolve(here, '../spec/openapi.json')
const outPath = resolve(here, '../src/schemas.gen.ts')

const die = (message) => {
  console.error(`✖ ${message}`)
  process.exit(1)
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'))

if (!/^3\.1\./.test(spec.openapi ?? '')) {
  die(
    `spec declares openapi ${spec.openapi}; this generator requires 3.1.x. ` +
      'Under 3.0 a nullable field is `nullable: true` rather than a null type union, ' +
      'and would translate into a schema that rejects legitimate nulls.',
  )
}

const schemas = spec.components?.schemas ?? {}
const names = Object.keys(schemas)
if (names.length === 0) die('spec has no components.schemas')

const REF = /^#\/components\/schemas\/(\w+)$/

/** Direct `$ref` dependencies of a schema, by name. */
const refsIn = (node, found = new Set()) => {
  if (Array.isArray(node)) {
    for (const child of node) refsIn(child, found)
    return found
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const match = REF.exec(value)
        if (!match) die(`unsupported $ref "${value}" — only #/components/schemas/X is handled`)
        found.add(match[1])
      } else {
        refsIn(value, found)
      }
    }
  }
  return found
}

/**
 * Topological order, so a schema's dependencies are declared before it.
 *
 * A cycle is a hard error rather than something to work around. Zod can express
 * one with `z.lazy`, but a cyclic API schema in this domain almost always means a
 * modelling mistake leaked into the contract — and the spec is authored here, so it
 * can be fixed at the source rather than accommodated downstream.
 */
const ordered = []
const state = new Map()

const visit = (name, stack) => {
  if (state.get(name) === 'done') return
  if (state.get(name) === 'visiting') {
    die(`cyclic $ref: ${[...stack, name].join(' → ')}`)
  }
  if (!(name in schemas)) die(`$ref to unknown schema "${name}"`)

  state.set(name, 'visiting')
  for (const dep of refsIn(schemas[name])) visit(dep, [...stack, name])
  state.set(name, 'done')
  ordered.push(name)
}

for (const name of names) visit(name, [])

// A `$ref` becomes a reference to the already-declared const rather than an inlined
// copy. Without this override json-schema-to-zod emits `z.any()` for every ref.
const parserOverride = (schema) => {
  if (schema && typeof schema === 'object' && typeof schema.$ref === 'string') {
    const match = REF.exec(schema.$ref)
    if (!match) die(`unsupported $ref "${schema.$ref}"`)
    return `${match[1]}Schema`
  }
  return undefined
}

const body = ordered.map((name) => {
  // No `name` option: passing one makes json-schema-to-zod emit its own
  // `const X = …` declaration, which would then be nested inside ours.
  const source = jsonSchemaToZod(schemas[name], { module: false, parserOverride })

  if (/\bz\.(any|unknown)\(\)/.test(source)) {
    die(
      `schema "${name}" translated to z.any()/z.unknown(), which validates nothing.\n` +
        '  This generator will not emit a permissive schema — it would read as coverage\n' +
        '  while accepting any payload at all. Either express the construct in a form\n' +
        `  json-schema-to-zod understands, or add explicit handling for it here.\n\n  ${source}`,
    )
  }

  return `export const ${name}Schema = ${source}\n`
})

const header = `/* eslint-disable */
/**
 * GENERATED by scripts/generate-schemas.mjs from spec/openapi.json. Do not hand-edit.
 *
 * Runtime validators for response bodies (ADR-0031). The compile-time types in
 * api.gen.ts come from the same spec, so the two cannot describe different shapes.
 *
 * Deliberately NOT \`.strict()\`: unknown keys are stripped rather than rejected, so
 * a backend adding a field cannot break the frontend. Missing required fields and
 * wrong types still fail, which is the set of changes that would otherwise corrupt
 * data silently.
 */
import { z } from 'zod'

`

writeFileSync(outPath, header + body.join('\n'), 'utf8')
console.log(`✔ ${ordered.length} schema(s) → src/schemas.gen.ts  (${ordered.join(', ')})`)
