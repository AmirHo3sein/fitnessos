/**
 * Boundary enforcement — implementation handbook §2.2.
 *
 * All rules are `error` severity. NO WAIVERS.
 * If a rule blocks you, the answer is an ADR in docs/v2/adr/, not an exclusion.
 *
 * Rules referencing packages that do not exist yet (ctx-*, infra, contracts)
 * are inert until those packages arrive, then active with no further work.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-react-in-logic',
      comment:
        'ADR: framework-free layers. kernel, domain, application, editor-engine and ' +
        'contracts must never import React, Next or React-bound TanStack Query. ' +
        'If you need reactivity here, you are in the wrong layer.',
      severity: 'error',
      from: {
        path:
          '^(packages/kernel|packages/editor-engine|packages/contracts|' +
          'packages/(core|ctx-[^/]+)/src/(domain|application))',
      },
      // NOTE: no `dependencyTypes` filter. An import of an uninstalled package
      // resolves as `unknown`, so filtering by type would let the violation
      // through in exactly the case we care about most — someone reaching for
      // React in a layer that does not depend on it.
      to: {
        path: '^(react|react-dom|next|@tanstack/react-query|zustand/react)($|/)',
      },
    },
    {
      name: 'no-contracts-escape',
      comment:
        'ADR-0011 / handbook §5. Generated contract types may only be consumed by ' +
        'infra/mappers. Anywhere else and a backend field rename becomes a UI change.',
      severity: 'error',
      from: { pathNot: '^(packages/contracts|packages/infra/src/mappers)' },
      to: { path: '^packages/contracts' },
    },
    {
      name: 'no-cross-context',
      comment:
        'ADR-0018 / ADR-0019. Bounded contexts never import each other. ' +
        'Cross-context composition is legal only in apps/web/composition ' +
        'and presentation/composition.',
      severity: 'error',
      from: { path: '^packages/ctx-([^/]+)/' },
      to: {
        path: '^packages/ctx-([^/]+)/',
        pathNot: '^packages/ctx-$1/',
      },
    },
    {
      name: 'no-presentation-to-infra',
      comment:
        'Handbook §2.2 (B1). Presentation must not construct or import infra. ' +
        'The DI container is assembled in apps/web/composition and passed in as a prop.',
      severity: 'error',
      from: { path: '/src/presentation/' },
      to: { path: '^packages/infra' },
    },
    {
      name: 'no-domain-to-app',
      comment: 'Dependencies point inward. domain may not know about application.',
      severity: 'error',
      from: { path: '/src/domain/' },
      to: { path: '/src/application/' },
    },
    {
      name: 'no-next-outside-app',
      comment:
        'Handbook §3.3. next/navigation and next/headers are app-shell concerns. ' +
        'A package that reaches for them has taken on routing responsibility it should not have.',
      severity: 'error',
      from: { pathNot: '^apps/web' },
      to: { dependencyTypes: ['npm'], path: '^next/(navigation|headers)' },
    },
    {
      name: 'no-deep-imports',
      comment:
        'Handbook §2.2. Packages are consumed through a DECLARED barrel only. ' +
        'Deep imports bypass the published surface and defeat every other rule here.',
      severity: 'error',
      from: {},
      to: {
        path: '^packages/([^/]+)/src/.+',
        // This allowlist is the registry of public subpath barrels.
        // dependency-cruiser cannot read a package.json `exports` map, so a new
        // declared subpath must be added here too. That is deliberate: widening
        // a package's public surface should require an explicit, reviewable edit.
        //
        //   src/index.ts              — the main barrel; every package has one
        //   src/presentation/index.ts — the "./presentation" export (ctx-*, ui)
        //
        // `presentation` is a separate entry point rather than part of the main
        // barrel because re-exporting it there would pull React into the
        // dependency graph of every framework-free consumer, transitively — and
        // `no-react-in-logic` would then fire on code that never mentioned React.
        pathNot:
          // A graduated ctx-* package: `.` and `./presentation`.
          '^packages/([^/]+)/src/(presentation/)?index\\.ts$|' +
          // packages/core hosts several un-graduated contexts, so its public surface
          // is per-context: `./auth`, `./auth/presentation`, and so on. These are the
          // same two barrels a graduated package exposes, one level deeper — which
          // means graduation is a move plus a package rename, and no import shape
          // changes.
          //
          // The aggregate `core/presentation` barrel that used to exist was removed
          // rather than kept alongside these. It re-exported every context's client
          // components, so importing one dragged in all of them: the sign-in page
          // shipped the athlete mapper and its validator. A barrel over `'use client'`
          // modules is not tree-shaken, because each is a bundler entry point.
          '^packages/core/src/[^/]+/(presentation/)?index\\.ts$',
        dependencyTypes: ['npm'],
      },
    },
    {
      name: 'no-llm-sdk-in-frontend',
      comment:
        'No model-provider SDK may appear anywhere in this graph. All assistance ' +
        'goes through a backend endpoint behind AssistancePort. An SDK here means a ' +
        'provider credential reachable from a browser bundle.',
      severity: 'error',
      from: {},
      to: {
        path:
          '^(openai|@anthropic-ai/[^/]+|@google/gener\\w*ai|@mistralai/[^/]+|' +
          'cohere-ai|replicate|langchain|@langchain/[^/]+|ai)($|/)',
      },
    },
    {
      name: 'no-telemetry-vendor-sdk',
      comment:
        'ADR-0032. Observability vendors are reached only through the TelemetryPort, and ' +
        'the sink is built in apps/web/composition. A vendor SDK imported anywhere else ' +
        'bypasses the closed event vocabulary — and these SDKs capture messages, stacks, ' +
        'breadcrumbs and request bodies by DEFAULT, which is the opposite of the ' +
        'guarantee the seam exists to provide.',
      severity: 'error',
      from: { pathNot: '^apps/web/composition/' },
      to: {
        path:
          '^(@sentry/[^/]+|@datadog/[^/]+|dd-trace|@opentelemetry/[^/]+|' +
          'posthog-js|mixpanel-browser|@amplitude/[^/]+|logrocket|@bugsnag/[^/]+)($|/)',
      },
    },
    {
      name: 'no-circular',
      comment: 'Circular imports inside a package indicate a missing boundary.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      comment:
        'An import that does not resolve is either a typo or a missing dependency. ' +
        'It also silently defeats every path-based rule above, because an ' +
        'unresolved module is classified `unknown` rather than `npm`.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-orphans',
      comment: 'Unreachable modules are dead code or a missing barrel export.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '(^|/)(babel|eslint|vitest|turbo|plop|next|postcss|tailwind|playwright)' +
            '\\.config\\.(js|cjs|mjs|ts|mts)$',
          '(^|/)(tsconfig|package)\\.json$',
          '(^|/)dependency-cruiser\\.cjs$',
          '(^|/)(eslint|vitest)\\.(base|react|component|component\\.setup)\\.(js|ts)$',
          // Next.js file conventions are entry points the framework discovers by
          // path. Nothing imports them, so they are orphans by construction.
          '^apps/web/middleware\\.ts$',
          '^apps/web/instrumentation(-client)?\\.ts$',
          '^apps/web/app/.*/(page|layout|template|loading|error|global-error|' +
            'not-found|route|default|sitemap|robots|opengraph-image|icon)\\.tsx?$',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        'node_modules',
        '\\.test\\.tsx?$',
        '\\.gen\\.ts$',
        // Generated by `next build`; references types that only exist inside the
        // installed next package's own resolution scope.
        '(^|/)next-env\\.d\\.ts$',
        // Playwright specs are discovered by path, like Next's file conventions, so
        // they are orphans by construction and are not part of the app's graph.
        '^apps/web/e2e/',
        '/dist/',
        '/\\.next/',
        '/\\.turbo/',
      ],
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
      // NOTE: no `paths`/alias support here, deliberately.
      //
      // apps/web briefly used a `@/*` alias. dependency-cruiser rejects an `alias`
      // key outright, and the documented alternative — pointing `options.tsConfig`
      // at the app's tsconfig — applies that tsconfig's `baseUrl` to the WHOLE
      // cruise. Any package could then resolve a bare specifier out of `apps/web`,
      // which quietly weakens `no-unresolvable`, and every path-based rule above
      // depends on that one holding.
      //
      // Extensionless relative imports resolve correctly in tsc, webpack and here,
      // with no configuration at all. Fewer mechanisms, strongest rule intact.
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
