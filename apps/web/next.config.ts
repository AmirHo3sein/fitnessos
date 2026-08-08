import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const config: NextConfig = {
  reactStrictMode: true,

  // Workspace packages ship TypeScript source rather than built output, so Next
  // has to compile them. The alternative — a build step per package — buys nothing
  // here and costs a watch rebuild on every edit.
  transpilePackages: [
    '@fitnessos/ui',
    '@fitnessos/core',
    '@fitnessos/infra',
    '@fitnessos/kernel',
  ],

  // Next infers the workspace root from the nearest lockfile and picks up a stray
  // one in the home directory. Pinning it keeps output file tracing correct.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)) + '/../..',

  typescript: {
    // The `typecheck` script and CI stage 3 own this. Letting `next build` also do
    // it means the same errors are reported twice, in two formats, and the build
    // gets slower for no additional signal.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  experimental: {
    // The React Compiler handles the memoisation that would otherwise be written
    // by hand. Note it does NOT replace the `useMemo` in composition/providers.tsx
    // — that one exists for reference stability of an injected value, which is a
    // correctness requirement rather than a performance optimisation, and the
    // compiler makes no promise about it.
    reactCompiler: true,
  },

  /**
   * In production, `/api/v1` is served on the same origin by a reverse proxy
   * (ADR-0025) and Next never sees those requests. There is no proxy in development
   * or in e2e, so the browser's relative `/api/v1/...` calls would hit Next and 404.
   *
   * This rewrite stands in for the proxy, and only when `STUB_API_URL` is set — which
   * it is not in any production deployment. That gate matters: a rewrite that always
   * existed would let a misconfigured production environment silently route API
   * traffic somewhere unintended rather than failing.
   *
   * A useful side effect is that development matches production topology. The client
   * uses the same relative base URL in both, so a same-origin assumption cannot be
   * accidentally broken in dev and discovered in production.
   */
  async rewrites() {
    const stub = process.env['STUB_API_URL']
    if (!stub) return []
    return [{ source: '/api/v1/:path*', destination: `${stub}/api/v1/:path*` }]
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default withNextIntl(config)
