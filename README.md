# FitnessOS

Frontend monorepo. Backend lives in a separate repository (Rust + Axum, ADR-0027).

## Governing documents

The architecture is frozen. Both live in the V1 repository until this repo takes
over documentation ownership:

- **`docs/v2/implementation-handbook.md`** — the implementation contract. Folder
  structure, dependency rules, state boundaries, editor engine spec, testing
  strategy, roadmap.
- **`docs/v2/adr/`** — architecture decision records 0001–0031 (0028, 0030 pending).

Deviating from the handbook requires an ADR, referenced by id in the lint rule
that would otherwise block the change. Changes are accepted only when they solve
a proven problem — a benchmark, a failing test, or a production incident.

## Layout

```
apps/web              Next.js application — route groups, middleware, composition root
packages/config       tsconfig · eslint · dependency-cruiser · vitest bases
packages/kernel       shared kernel — ids · Result · Quantity · temporal · Money · Locale
packages/contracts    OpenAPI spec → generated types + Zod validators (ADR-0026, 0029)
packages/infra        adapters — http client, mappers, ports implementations
packages/core         bounded contexts that have not graduated to their own package
packages/ctx-*        graduated bounded contexts
packages/ui           shared React layer — primitives, patterns, DI factory
tools/generators      plop generators
tools/bundle-budget   CI stage 9
```

## Commands

```bash
pnpm install
pnpm check              # typecheck + lint + boundaries + unit + integration + component
pnpm typecheck
pnpm lint               # eslint + dependency-cruiser
pnpm test:unit
pnpm test:integration   # infra against MSW
pnpm test:component     # jsdom
pnpm build              # needs INTERNAL_API_URL
pnpm bundle:budget      # reads the manifests build produced
pnpm e2e:critical       # needs a build first
```

## The rules that matter

1. `kernel`, `domain`, `application`, `editor-engine` and `contracts` never import
   React or Next. Enforced by `dependency-cruiser`, not by convention.
2. Contract types never escape `infra/mappers`.
3. Bounded contexts never import each other. Cross-context composition happens in
   `apps/web/composition` only.
4. No package is consumed except through a **declared** barrel — `src/index.ts` or
   `src/presentation/index.ts`. The allowlist in `no-deep-imports` is the registry
   of public subpaths; widening it is a deliberate, reviewable edit.
5. The DI container is assembled in `apps/web/composition` and passed to providers
   as a prop. Presentation never constructs infrastructure. **Ports are provided by
   the route group that uses them** — not by the root layout (ADR-0031).
6. Response bodies are validated against the generated contract schema before mapping.
   Mapper entry points take `unknown`, so this cannot be bypassed (ADR-0031).
7. No model-provider SDK appears anywhere in the graph. All assistance goes through
   a backend endpoint behind `AssistancePort`.

`pnpm lint` fails the build on any violation. There are no waivers — the answer to
a blocking rule is an ADR.

## Status

Phase 0 and the Phase 1 scaffold are complete.

- [x] Workspace, Turborepo, tsconfig bases
- [x] `dependency-cruiser` boundary rules — **violation-probed, see below**
- [x] ESLint base with exhaustiveness and no-`any`; React config with a11y and the XSS ban
- [x] `@fitnessos/kernel` — ids, Result, Quantity, temporal, Money, Locale · 29 tests
- [x] `tools/generators` — `gen:context`, 7 tests
- [x] `packages/core` — host for un-graduated contexts, plus the Athlete context
- [x] `packages/contracts` — committed-spec stopgap per ADR-0026, types **and** runtime Zod validators from one spec (ADR-0029), drift-checked
- [x] `packages/infra` — http client with single-flight refresh, tiered mappers, adapters, **response validation** · 18 unit + 12 integration
- [x] `packages/ui` — React Aria primitives, `<SafeHtml>`, DI factory · 21 tests
- [x] `apps/web` — route groups, middleware guard, RSC prefetch, composition root · 16 e2e
- [x] CI stages 1–11

**85 tests + 16 e2e. All CI stages live.**

## Import convention

**Relative imports carry no file extension.** `./lib/cn`, not `./lib/cn.js`.

An earlier draft used `.js` suffixes, on the reasoning that they are correct for
`verbatimModuleSyntax` and Node ESM. They are not correct *here*: packages are
consumed as TypeScript source (`main: ./src/index.ts`), resolution is
`moduleResolution: "bundler"`, and every package is `noEmit`. Those suffixes
described build output that will never exist — and Next's webpack resolver does not
perform the `.js` → `.ts` substitution tsc does, so the app could not compile.

Extensionless resolves correctly in tsc, webpack, vitest and dependency-cruiser with
no configuration. `apps/web` briefly used a `@/*` path alias to sidestep the problem;
that was reverted, because dependency-cruiser rejects an `alias` option and the
documented alternative applies the app's `baseUrl` to the entire cruise — which lets
any package resolve a bare specifier out of `apps/web` and quietly weakens
`no-unresolvable`, the rule every other path rule depends on.

## Testing pyramid

| Tier | Share | Where | Environment |
|---|---|---|---|
unit | 70% | `*.test.ts` | node, no DOM |
integration | 20% | `*.int.test.ts` | node + MSW |
component | 8% | `*.test.tsx` | jsdom |
e2e | 2% | `apps/web/e2e/*.spec.ts` | Playwright |

Geometry — drag, snap, hit-testing, virtualised scroll — is never tested in jsdom.
There is no layout engine there, so `getBoundingClientRect` returns zeros and the
test asserts on nothing. It goes to Playwright, or better, to a unit test of the
pure function with no DOM at all.

The `*.int.test.ts` glob also matches the unit tier's `include`, so the unit config
excludes it explicitly. Without that, the integration suite runs twice and the fast
tier stops being fast.

## What the boundary probes cover

Each rule has been shown to fail on a deliberate violation, not merely to pass on
a clean tree:

| Rule / guard | Probe |
|---|---|
`no-react-in-logic` | `import { useState } from 'react'` in `kernel` |
`no-contracts-escape` | contract import in `infra/http/` rather than `infra/mappers/` |
`no-presentation-to-infra` | `@fitnessos/infra` imported from a `presentation/views/` file |
`no-unresolvable` | any of the above from a package that lacks the dependency |
XSS ban (eslint) | `dangerouslySetInnerHTML` in a non-`safe-html` file |
locale ban (eslint) | `toLocaleString()` with no argument |
schema generator refuses `z.any()` | a schema using `not` + `contentMediaType` |
schema generator rejects cycles | `TrainingIdentity → Athlete → TrainingIdentity` |
schema generator requires 3.1 | spec declaring `openapi: 3.0.3` |
type/validator agreement | a field removed from a generated schema |
contract drift | a field added to the spec without regenerating |

Worth knowing: a violation from a package that does not *declare* the dependency
trips `no-unresolvable` rather than the specific rule. Blocked either way, but if
you are verifying a specific rule, probe from a package that declares the
dependency — otherwise you prove the wrong thing.

### Boundary rules are probe-verified, not assumed

The rule set was tested against deliberate violations rather than trusted. Doing
so surfaced a real hole: an import of an **uninstalled** package resolves with
`dependencyTypes: ["unknown"]`, so a rule filtering on `npm` silently permits it —
precisely the case that matters, since a layer forbidden from using React will not
have React installed.

Two corrections followed:

1. `no-react-in-logic` matches by module path with **no** `dependencyTypes` filter.
2. A `no-unresolvable` rule was added at `error` severity, because an unresolved
   import defeats every path-based rule above it.

Re-probe both after any change to the rule set. A boundary rule that has never
been shown to fail is decoration.

## Generators

```bash
pnpm gen:context development complex   # own ctx-* package
pnpm gen:context affiliation core      # folder in packages/core
pnpm gen:context                       # interactive
```

Both prompts are `input` rather than `list` so the generator is scriptable — CI has
to run it headlessly, and an arrow-key prompt cannot be piped.

Generated output is verified at two levels, because neither alone is sufficient:

| Layer | Proves |
|---|---|
`tools/generators/plopfile.test.mjs` | templates render, no unresolved Handlebars, expected file set, conventions the boundary rules depend on |
CI generated-context stage | the output actually typechecks and lints |

Rendering cleanly proves nothing about types. Checking committed output proves
nothing about the *next* generation.

**`FITNESSOS_GEN_ROOT`** redirects the destination base. The generator builds
absolute paths, which bypass node-plop's own `destBasePath`, so this is the only
thing that isolates a test run — without it the tests write into the real
workspace. That happened once during Phase 0; the env override is the fix.

## Contracts

```bash
pnpm contracts:generate                                  # spec → types
pnpm --filter @fitnessos/contracts contracts:check       # what CI runs
```

`spec/openapi.json` is the **committed stopgap** from ADR-0026 — hand-authored and
spec-first, replaced by the published `@fitnessos/api-spec` package when the
backend pipeline exists. The only thing that changes then is where the spec is
read from.

Contract types are deliberately awkward to hold (`components['schemas'][…]` rather
than tidy aliases) so that mapping to an application type is the path of least
resistance. Mapping is tiered — see `infra/src/mappers/athlete.ts`:

| Tier | When | Cost |
|---|---|---|
| branded alias | shapes identical, type inert | ~1 line |
| field mapper | names differ, or a `Quantity` is needed | ~10 lines |
| full mapper | target has behaviour and invariants | ~40 lines |

Two disciplines the athlete mapper demonstrates, both of which earlier drafts got
wrong:

- **The target types are declared by the application layer, not by the mapper.** A
  parallel type family in `infra` drifts from the one the application uses, and
  nothing detects the drift.
- **Enums are declared, never aliased off the contract.** `ContractAthlete['status']`
  looks like insulation while transmitting a backend enum change perfectly, into
  every `switch` in the codebase. A declared union breaks compilation at the
  mapper — the one place someone can decide what the new value means in our
  language.

Each mapper also carries a `*_COVERAGE` map (`Record<keyof ContractX, true>`). Add a
field to the contract and that map stops compiling — the build fails at one line
instead of the field being silently dropped and surfacing as missing data a year
later (D-09).

## apps/web notes

Things in the app that are load-bearing and not obvious:

- **`(app)` is `force-dynamic`, explicitly.** Reading `cookies()` is supposed to opt
  a route out of prerendering. It did not: the first build emitted the authenticated
  dashboard as SSG. An authenticated shell rendered once at build time and served
  from cache is not something to leave to an inferred opt-out.
- **`generateStaticParams` is per-route, not on the `[locale]` layout.** next-intl's
  guidance puts it on the layout; that guidance assumes every route is static.
  Declaring it on a layout shared by public and authenticated groups prerendered
  *all* descendants, overriding `force-dynamic` on both the group layout and the
  page. Public routes now declare their own params. Forgetting costs a dynamic
  render, which is the safe direction to fail in.
- **`localeDetection: false`.** Found by e2e: `Accept-Language: en-US` beat
  `defaultLocale: 'fa'`, so `/` redirected to `/en`. Windows installations in Iran
  commonly report en-US regardless of who is using them. The request-based test
  passed the whole time because a bare `request.get()` sends no Accept-Language —
  only the browser-driven check caught it.
- **The middleware guard is a redirect, not a gate.** It checks cookie *presence*.
  It cannot validate the token — the signing key belongs to the backend — and it
  should not, because every protected response is already authorised by the API. A
  forged cookie gets past it and then gets a 401, which is correct. An e2e test
  asserts exactly that, so the boundary stays honest.
- **Server-mode HTTP never refreshes.** Refresh tokens rotate strictly, and an RSC
  render cannot deliver the resulting `Set-Cookie` to the browser. Refreshing on the
  server would discard the new token while revoking the old one — a silent logout on
  navigation, caused by the refresh meant to prevent one.
- **`<SafeHtml>` uses `xss`, not DOMPurify.** DOMPurify needs a DOM, so making it
  isomorphic means shipping jsdom — which put megabytes into the server bundle and
  broke `next build`, because jsdom reads its own stylesheet from disk at runtime.
  A parser-based sanitiser behaves identically in Node and the browser, which is the
  stronger property: one implementation, and no chance of the two paths diverging
  into a hydration mismatch that resolves in the client's favour.
- **The DI seam.** `createDiContext` in `packages/ui` lets each context declare a
  typed context over its own ports. The app mounts every provider with a concrete
  instance built in `composition/`. Presentation never imports infra, nothing points
  inward from the app, and no context can reach another's ports at runtime — which is
  `no-cross-context` holding in the browser as well as at lint time.

## Contract validation (ADR-0029, ADR-0031)

One spec produces two artefacts in one command:

```
spec/openapi.json ──┬─► openapi-typescript      ─► src/api.gen.ts     (compile time)
                    └─► scripts/generate-schemas ─► src/schemas.gen.ts (runtime, Zod)
```

Every response body is validated before it is mapped. `athleteFrom` takes `unknown`,
and `HttpClient.request` defaults its type parameter to `unknown` — so the lazy call is
also the safe one, and there is no typed value to pass into a mapper without going
through the validator.

Three properties that are easy to get wrong, and were:

- **The generator refuses to emit a permissive schema.** `json-schema-to-zod` returns
  `z.any()` for anything it cannot interpret, including an unresolved `$ref`. Any
  `z.any()` in the output aborts the build. A validator that accepts everything is
  worse than none, because it reads as coverage.
- **Schemas are not `.strict()`.** Unknown keys are stripped, so an additive backend
  change cannot break the frontend. Missing required fields, wrong types, undeclared
  enum values and violated numeric constraints all fail. Tolerant reader, strict writer
  — which is what makes always-on validation safe in production.
- **The drift check does not use `git diff`.** The first version did, and was vacuous:
  git reports no change for an untracked file, so it passed while comparing nothing.
  `scripts/check-drift.mjs` compares content directly and depends on nothing outside
  itself.

`FieldsAgree<A, B>` asserts at compile time that the openapi-typescript type and the
Zod-inferred type describe the same field set. They come from one file in one run, so
they should never differ — which is exactly why it is worth four lines to check: if they
ever do, the type promises one shape while the validator enforces another.
