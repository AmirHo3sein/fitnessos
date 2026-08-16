#!/usr/bin/env node
/**
 * Do the two halves of the telemetry vocabulary still agree?
 *
 * ## Why this needs a script at all
 *
 * The vocabulary is enforced on BOTH sides, and that is deliberate. `packages/telemetry/src/events.ts`
 * is a closed union with no `payload: unknown`, no `metadata` map and no `message: string`, so a phone
 * number or an athlete's goal in their own words cannot be expressed. `VOCABULARY` in the API's
 * `telemetry.rs` refuses an unknown kind, and refuses a known kind wearing an undeclared field.
 *
 * The server's half is not redundant. `POST /telemetry` takes no session by design — `session-lost` is
 * reported at exactly the moment there is none to authenticate with — so anybody can post to it, and
 * "the client only sends closed shapes" is a hope rather than a guarantee. An audit posted
 * `{"kind":"audit-probe","phone":"…","token":"…"}` and it was written to `jsonb` verbatim.
 *
 * ADR-0002's data-residency position rests on these rows containing nothing that ever needed a
 * residency decision. That holds only while both halves say the same thing, and until now only a
 * person kept them in step.
 *
 * ## Why it is a script rather than a test
 *
 * The two files live in two repositories. There is no build step that sees both, and vendoring a copy
 * of one into the other would create a third thing to keep in step — the problem, with an extra step.
 * So this reads both from disk and is run by a person, or by anything that has both checked out.
 *
 *   pnpm telemetry:parity                       # ../fitnessos-api by default
 *   API_REPO=/path/to/fitnessos-api pnpm telemetry:parity
 *
 * Absent API repo exits 0 with a notice, because "cannot check" is not "they disagree" — and a script
 * that goes red on every machine that does not happen to have a sibling checkout is a script people
 * stop running. Disagreement exits 1.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const EVENTS_TS = resolve(here, '../../packages/telemetry/src/events.ts')
const apiRepo = process.env['API_REPO'] ?? resolve(here, '../../../fitnessos-api')
const TELEMETRY_RS = resolve(apiRepo, 'src/presentation/telemetry.rs')

/**
 * The client's half: every `export interface …Event` that declares a literal `kind`, and the
 * `readonly` field names inside it.
 *
 * Parsed with regexes rather than the TypeScript compiler. That is a real limitation and worth being
 * explicit about: it works because this file is a deliberately plain closed union — flat interfaces,
 * one literal `kind` each, no generics, no mapped types. If that ever stops being true this script
 * reports a mismatch it cannot explain, which is annoying but not silent. Silent is the failure mode
 * worth avoiding.
 */
const readClient = (source) => {
  const vocabulary = new Map()

  for (const block of source.split(/^export interface /m).slice(1)) {
    const body = block.slice(block.indexOf('{') + 1, block.indexOf('\n}'))
    const kind = /readonly kind: '([^']+)'/.exec(body)?.[1]
    if (kind === undefined) continue

    const fields = [...body.matchAll(/^\s*readonly ([A-Za-z][A-Za-z0-9]*)[?]?:/gm)].map((m) => m[1])
    vocabulary.set(kind, new Set(fields))
  }

  return vocabulary
}

/**
 * The server's half: the `VOCABULARY` const, which is a slice of `(&str, &[&str])`.
 *
 * Read from the one place that is load-bearing rather than from a comment, so a divergence between
 * the const and its own documentation is caught too.
 */
const readServer = (source) => {
  const start = source.indexOf('const VOCABULARY')
  if (start === -1) throw new Error(`no VOCABULARY in ${TELEMETRY_RS}`)
  const body = source.slice(start, source.indexOf('];', start))

  const vocabulary = new Map()
  for (const entry of body.matchAll(/"([a-z-]+)",\s*&\[([^\]]*)\]/g)) {
    const fields = [...entry[2].matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((m) => m[1])
    vocabulary.set(entry[1], new Set(fields))
  }

  return vocabulary
}

if (!existsSync(TELEMETRY_RS)) {
  console.log(`[telemetry:parity] SKIPPED — no API repo at ${apiRepo}`)
  console.log('[telemetry:parity] set API_REPO to check, e.g. API_REPO=../fitnessos-api')
  process.exit(0)
}

const client = readClient(readFileSync(EVENTS_TS, 'utf8'))
const server = readServer(readFileSync(TELEMETRY_RS, 'utf8'))

const problems = []

for (const kind of client.keys()) {
  if (!server.has(kind)) {
    problems.push(`${kind}: the client can send it and the server would refuse it (400)`)
  }
}
for (const kind of server.keys()) {
  if (!client.has(kind)) {
    problems.push(`${kind}: the server accepts it and no client emits it — dead vocabulary`)
  }
}

for (const [kind, clientFields] of client) {
  const serverFields = server.get(kind)
  if (serverFields === undefined) continue

  for (const field of clientFields) {
    if (!serverFields.has(field)) {
      // The consequential direction. The client emits it, the server refuses the WHOLE batch with a
      // 400, and the client never retries — so the reports simply stop, silently.
      problems.push(`${kind}.${field}: the client sends it and the server does not declare it`)
    }
  }
  for (const field of serverFields) {
    if (!clientFields.has(field)) {
      // The other direction is a hole rather than a break: the server would store a field no client
      // is supposed to send, which is exactly the gap the vocabulary exists to close.
      problems.push(`${kind}.${field}: the server would accept it and no client declares it`)
    }
  }
}

if (problems.length > 0) {
  console.error('[telemetry:parity] the two halves of the vocabulary disagree:\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\n  client: packages/telemetry/src/events.ts')
  console.error(`  server: ${TELEMETRY_RS}`)
  console.error('\nADR-0002 rests on these rows carrying nothing that needed a residency decision.')
  process.exit(1)
}

const total = [...client.values()].reduce((n, fields) => n + fields.size, 0)
console.log(`[telemetry:parity] ${String(client.size)} kinds, ${String(total)} fields, both halves agree`)
