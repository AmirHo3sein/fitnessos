import { readFile } from 'node:fs/promises'

/**
 * Playwright global setup: refuse to run against a build that cannot reach the API, then reset the
 * stub.
 *
 * The order matters. The point of the first check is to fail before anything else gets a chance to
 * fail confusingly.
 */

/**
 * The rewrite standing in for the production reverse proxy is baked in at BUILD time, and only when
 * `STUB_API_URL` is set — see `next.config.ts`, where that gate is deliberate so a misconfigured
 * production cannot silently route API traffic somewhere unintended.
 *
 * `pnpm start` serves whatever is already in `.next`, and Playwright reuses it locally. So a single
 * `pnpm build` run without the variable — to check a bundle size, say — leaves every relative
 * `/api/v1/...` call 404ing, and the suite fails with dozens of tests reporting missing form fields
 * and "could not send". Nothing in that output mentions a rewrite.
 *
 * It cost a full misdiagnosis: the local suite was written off as an unfaithful environment, when the
 * only thing unfaithful about it was a build broken by the person reading the results.
 *
 * Checking the running server would be more direct, but this file runs before the webServer processes
 * are guaranteed up. The manifest carries the same fact, earlier.
 */
const assertApiRewriteIsBuiltIn = async (): Promise<void> => {
  const manifestPath = new URL('../.next/routes-manifest.json', import.meta.url)

  let manifest: string
  try {
    manifest = await readFile(manifestPath, 'utf8')
  } catch {
    // No build at all. `pnpm start` fails on its own with a clearer message than anything invented
    // here, so say nothing.
    return
  }

  const { rewrites } = JSON.parse(manifest) as {
    rewrites?: { afterFiles?: { source: string }[] }
  }
  const hasApiRewrite = (rewrites?.afterFiles ?? []).some((rule) => rule.source === '/api/v1/:path*')

  if (!hasApiRewrite) {
    throw new Error(
      [
        'This build has no /api/v1 rewrite, so every API call will 404 and the suite will fail in',
        'ways that say nothing about the cause: missing form fields, "could not send", timeouts.',
        '',
        'It was built without STUB_API_URL. Rebuild with it:',
        '',
        '  STUB_API_URL=http://127.0.0.1:8791 pnpm --filter @fitnessos/web build',
        '',
        'The rewrite is gated on that variable on purpose (next.config.ts): one that always existed',
        'would let a misconfigured production route API traffic somewhere unintended.',
      ].join('\n'),
    )
  }
}

/**
 * Reset the stub before the suite runs.
 *
 * A connection failure is tolerated — a stub that is not yet listening has no state to clear, which
 * is the desired end condition anyway. A hard failure here would turn a cold start into a red suite.
 */
const resetStubState = async (): Promise<void> => {
  const base = process.env['STUB_API_URL'] ?? 'http://127.0.0.1:8791'
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fetch(`${base}/__reset`, { method: 'POST' })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

export default async function globalSetup(): Promise<void> {
  await assertApiRewriteIsBuiltIn()
  await resetStubState()
}
