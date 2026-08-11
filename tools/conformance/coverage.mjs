/**
 * Which of the contract's endpoints exist yet.
 *
 * The conformance suite answers "does this behave correctly?" and assumes the endpoint is there. When
 * a backend is being built from nothing, the prior question is "is it there at all?", and every
 * conformance check would fail for the same uninteresting reason.
 *
 * So this probes each declared path and reports a map. It is deliberately NOT a gate: an unimplemented
 * endpoint is a to-do, not a regression. Run it and watch it go from 0/29 to 29/29.
 *
 * ```sh
 * COVERAGE_BASE_URL=http://127.0.0.1:8791/api/v1 node tools/conformance/coverage.mjs
 * ```
 *
 * ## How presence is judged
 *
 * Unauthenticated, on purpose — this asks about routing, not about behaviour, and a session should not
 * be needed to find out whether a route is wired.
 *
 *   404 / 501     absent
 *   401 / 403     PRESENT and asking for a session, which is the correct answer to an anonymous probe
 *   anything else present
 *
 * A 405 is reported separately, because "the path exists with a different method" is a distinct and
 * useful state: usually a route half-implemented.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const spec = JSON.parse(
  readFileSync(join(here, '../../packages/contracts/spec/openapi.json'), 'utf8'),
)

const baseUrl = (process.env['COVERAGE_BASE_URL'] ?? 'http://127.0.0.1:8791/api/v1').replace(
  /\/$/,
  '',
)

/** A syntactically valid placeholder, so a 400 cannot be mistaken for a missing route. */
const PLACEHOLDER = '00000000-0000-7000-8000-000000000000'

const operations = []
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const method of Object.keys(methods)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
    operations.push({ method: method.toUpperCase(), path })
  }
}
operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))

const classify = (status) => {
  if (status === 404 || status === 501) return 'absent'
  if (status === 405) return 'wrong-method'
  return 'present'
}

const probe = async ({ method, path }) => {
  const url = `${baseUrl}${path.replace(/\{[^}]+\}/g, PLACEHOLDER)}`
  try {
    const response = await fetch(url, {
      method,
      // A body only where one is required, and deliberately empty: a 400 still proves the route
      // exists, which is all this asks.
      ...(method === 'GET' || method === 'DELETE'
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: '{}' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    })
    return { method, path, status: response.status, state: classify(response.status) }
  } catch (error) {
    return {
      method,
      path,
      status: 0,
      state: 'unreachable',
      why: error instanceof Error ? error.message : 'unknown',
    }
  }
}

const results = []
for (const operation of operations) results.push(await probe(operation))

const present = results.filter((r) => r.state === 'present')
const absent = results.filter((r) => r.state === 'absent')
const wrongMethod = results.filter((r) => r.state === 'wrong-method')
const unreachable = results.filter((r) => r.state === 'unreachable')

if (unreachable.length === results.length) {
  console.error(`✖ nothing at ${baseUrl} — is it running?`)
  console.error(`  ${unreachable[0]?.why ?? ''}`)
  process.exitCode = 1
} else {
  console.log(`Contract coverage at ${baseUrl}\n`)
  const pad = Math.max(...results.map((r) => r.path.length))
  for (const r of results) {
    const mark = { present: '✔', absent: '·', 'wrong-method': '~', unreachable: '?' }[r.state]
    console.log(
      `  ${mark} ${r.method.padEnd(6)} ${r.path.padEnd(pad)}  ${r.status === 0 ? 'no response' : String(r.status)}`,
    )
  }
  console.log(
    `\n  ${String(present.length)}/${String(results.length)} implemented` +
      (wrongMethod.length > 0 ? `, ${String(wrongMethod.length)} wrong method` : '') +
      (absent.length > 0 ? `, ${String(absent.length)} absent` : '') +
      (unreachable.length > 0 ? `, ${String(unreachable.length)} unreachable` : ''),
  )
  if (absent.length > 0) {
    console.log('\n  Absent, in the order a vertical slice would want them:')
    const order = ['/auth/', '/athletes/', '/goals', '/programs', '/sessions', '/observations']
    const rank = (p) => {
      const index = order.findIndex((prefix) => p.startsWith(prefix))
      return index === -1 ? order.length : index
    }
    for (const r of [...absent].sort((a, b) => rank(a.path) - rank(b.path))) {
      console.log(`    ${r.method} ${r.path}`)
    }
  }
}
