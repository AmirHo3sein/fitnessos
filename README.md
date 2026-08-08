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
packages/core         un-graduated bounded contexts; each exposes `./{ctx}` and `./{ctx}/presentation`
packages/ctx-*        graduated bounded contexts
packages/ui           shared React layer — primitives, patterns, DI factory
packages/telemetry    observability seam — closed event vocabulary, no vendor (ADR-0032)
tools/generators      plop generators
tools/stub-api        stands in for the backend in e2e and local dev
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
pnpm e2e:critical       # starts the stub API and the app itself
pnpm dev:api            # stub API alone, for `pnpm dev` against fake data
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
- [x] `packages/core` — host for un-graduated contexts: **Athlete** (read) and **Auth** (write)
- [x] `packages/contracts` — committed-spec stopgap per ADR-0026, types **and** runtime Zod validators from one spec (ADR-0029), drift-checked
- [x] `packages/infra` — http client with single-flight refresh, tiered mappers, adapters, **response validation** · 18 unit + 12 integration
- [x] `packages/ui` — React Aria primitives, `<SafeHtml>`, DI factory · 21 tests
- [x] `apps/web` — route groups, middleware guard, RSC prefetch, per-group composition, **working sign-in** · 24 e2e
- [x] CI stages 1–11

**283 tests + 56 e2e. All CI stages live.**

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

## Tree-shaking and barrels

Every workspace package declares `sideEffects: false` (`ui` declares `["*.css"]`).
Without it webpack must assume every module in a package is impure and cannot drop
unused re-exports from a barrel — which is not a theoretical cost. Adding it took the
`(app)` layout from 61.9 kB gz to 35.2 and the dashboard from 37.3 to 19.1, with no
code change.

`packages/core` exposes one barrel pair **per context** — `./auth` and
`./auth/presentation` — rather than one aggregate `./presentation`. The aggregate was
removed after the budget caught what it cost: a barrel over `'use client'` modules is
not tree-shaken, because each client module is a bundler entry point, so importing
`SignInForm` dragged in every other context's components. The per-context shape is
also exactly what a graduated `ctx-*` package exposes, so graduation is a move plus a
rename and no import changes shape.

There is deliberately no `createContainer` that builds every port. A single factory
means importing it constructs every adapter, mapper and validator — tree-shaking
cannot help, because the factory genuinely uses them all. Each context has its own
factory in `apps/web/composition/`, and a route group imports only what it mounts.

## Sign-in

The Auth context is the first write path, and the first to demonstrate that the
per-route-group port rule generalises beyond the context it was derived from.

Two things carry most of the weight, both specific to the market:

**Digit normalisation.** A Persian keyboard produces `۰۹۱۲۳۴۵۶۷۸۹` and an Arabic one
`٠٩١٢٣٤٥٦٧٨٩`. Neither is an ASCII digit — `Number()` returns `NaN` and `/^\d+$/`
does not match. Without `normalizeDigits` (in the kernel, not a form helper) the user
types the number printed on their own SIM and the form calls it invalid. The same
applies to the OTP code.

**One canonical phone.** `09123456789`, `+989123456789`, `0912 345 6789`,
`00989123456789` and `9123456789` are the same person. A system that treats them as
different creates duplicate accounts, and the duplicate is only discovered when
someone cannot see their own history. `PhoneNumber` reduces every accepted form to
E.164 — including a zero-width non-joiner, which Persian keyboards insert and which
survives copy-paste.

The flow is a discriminated union, not a set of booleans: `phase`, `isLoading`,
`hasCode` and `error` as independent flags admit sixteen states, of which four are
meaningful. The normalised phone exists only in the `awaiting-code` state, so
verification cannot be attempted against a re-parse of whatever is in the input —
which is what happens when a user retypes their number while waiting for the SMS.

## The stub API

`tools/stub-api` stands in for the backend, which lives in another repository
(ADR-0026). Before it existed the e2e suite could prove a phone number was normalised
but not that a correct code establishes a session, and not that a forged cookie is
refused — the two assertions that actually matter.

```bash
pnpm dev:api    # http://127.0.0.1:8791
```

| | |
|---|---|
| code that verifies | `000000` |
| state | keyed by phone — each number is a distinct athlete |
| phone ending `0000` | treated as a new person, so onboarding is reachable |
| any other code | 400 `code_invalid` |
| unissued `access_token` | 401 `unauthenticated` |

Three properties are deliberate:

- **It is a separate process, never part of the app build.** A Route Handler inside
  `apps/web` would have been less code and a much worse idea — an endpoint that returns
  fabricated athlete data must not be *capable* of existing in a production bundle.
- **Every response is validated against the same generated schema the client validates
  it with.** A stub that drifts from the contract is worse than no stub: the suite goes
  green against a shape the real backend will never produce. There is no unvalidated
  `send`.
- **Fixtures are fixed, never random.** `Math.random()` in a fixture is how a suite
  becomes flaky without anyone changing a line of it.
- **Athlete state is keyed by phone.** The first version held one mutable athlete for
  the whole process, which is a flake generator under `fullyParallel` — the onboarding
  spec writes `advanced`/5 days while the sign-in spec asserts `intermediate`, and
  whichever ran first decided the result. Keying by phone means a test gets its own
  athlete by using its own number: no reset endpoint, no serialisation, no shared
  fixture to reason about.

The browser reaches it through a `/api/v1` rewrite in `next.config.ts` that exists only
when `STUB_API_URL` is set — standing in for the production reverse proxy (ADR-0025),
which Next never sees. Development therefore matches production topology: the client
uses the same relative base URL in both, so a same-origin assumption cannot be broken
in dev and discovered in production. The gate matters as much as the rewrite: one that
always existed would let a misconfigured production environment route API traffic
somewhere unintended instead of failing.

## The write path

`Athlete` is the first context with both directions, and the two are deliberately
asymmetric.

**Reads produce snapshots; writes go through value objects.** `AvailabilitySnapshot`
has no invariants and accepts whatever the backend holds, including data written before
a rule existed. `Availability` — a value object — refuses anything the rules forbid.
This is the same principle as the non-strict response schemas: **tolerant reader, strict
writer.** One type doing both jobs would force a choice between rejecting historical
data on read and accepting nonsense on write.

The rules are not form validation. Availability is the primary input to prescription, so
a nonsense value produces a nonsense programme, which the athlete experiences as the
product not understanding them. Concretely:

| Rule | Why |
|---|---|
| `daysPerWeek` is a whole number 1–7 | 3.5 days is meaningful to a person and impossible to schedule; rounding resolves the ambiguity by a rule nobody chose |
| a zero ceiling is an error, not "no limit" | zero means *cannot train at all* — the opposite statement, and what a half-finished form submits |
| ceiling ≥ 10 minutes | below that a session holds neither a warm-up nor a working set |
| `trainingAgeMonths` ≤ 80 years | the field is months and people type years; `2024` sails past a `>= 0` check into every progression calculation |
| disciplines non-empty | an athlete trains *something*; an empty list is a skipped form |
| equipment and disciplines deduplicated and sorted | otherwise two athletes who chose the same things in a different order write different values |

Note the disciplines rule is **stricter than the contract**, which permits an empty
array. That asymmetry is the point, and a test asserts it: the read side accepts an
athlete recorded before the rule, the write side will not create another.

**Value objects are branded with a real symbol**, not `declare const brand: unique
symbol`. The declared form is correct for a primitive, where the brand is a type-level
fiction over a string. For an object it fails: the constructor cannot assign a property
that exists only in the type system, so building one needs `as unknown as Availability`
— a double cast that suppresses exactly the check the brand was added for. A real
unexported symbol can be assigned, so no code outside the module can produce a
conforming value. Unforgeable, no cast, and it never reaches the wire since
`JSON.stringify` skips symbol keys.

**Requests are validated on the way out**, closing ADR-0031's follow-up. Validating what
we send turns a mapper bug into a field path at the boundary instead of a 400 whose
diagnostic is a status code and a message written for an operator. The resource name
carries the direction — `CompleteOnboardingBody (request)` — so telemetry can tell our
defect from the server's.

**The mutation sets the cache rather than invalidating it.** The endpoint returns the
server's own view of the athlete, so invalidating would discard it and immediately
refetch what we already hold — an extra round trip at the end of a form, on the slowest
connection in the flow. Invalidation remains the right tool when a mutation's effects
are wider than its response; that is what `athleteInvalidations` is for.

**`PUT`, not `POST`.** Onboarding is a form a user will resubmit after a network hiccup,
and an idempotent verb makes that safe without a client-generated request id.

## The Goal context

The psychological centre of the domain (ADR-0004). People do not wake up wanting to
improve a capability — they wake up wanting to run 10k without stopping, or to carry
their child upstairs. The athlete's phrasing is stored **verbatim** because losing it is
not recoverable: a coach reading "get stronger" cannot reconstruct that the athlete said
"stop feeling weak when I pick up my daughter".

Two ADRs shape the whole context, and both are tempting to break.

**ADR-0018 — a Goal references nothing.** No programme, session, observation or proposal
id. The moment it holds one it becomes a coordination record and every context touching
programmes has to know about goals. The link runs the other way: `ProgramVersion` carries
`ServesGoal` (ADR-0008), which states current purpose and is never an input to outcome
evaluation. A test asserts the absence.

**ADR-0006 — staleness, horizon expiry and closure are derived, not stored.** There is no
`status`, no `isExpired`, no `isOverdue`, and no `lastEvaluatedAt`. A stored flag is wrong
the instant time passes, which means something has to write it: a scheduled job, or a
state machine spanning this context and Learning. Both are rejected. `isPastHorizon`,
`isDueForEvaluation` and `daysOverdueForEvaluation` are functions taking the current date.

`lastEvaluatedOn` is a **parameter**, not a field. The record of having evaluated
something is a `DecisionOutcome` in the Learning context, which may neither read nor write
another context's model (ADR-0019) — so Goal cannot know it, must not cache a copy, and
receives it from whatever composed the two at the query layer. Two tests cover the absent
fields, including one that says: *if this fails, delete the field, not the test.*

### Text handling is not the same rule twice

The two text value objects in this codebase normalise in **opposite** directions, and both
are correct:

| | `PhoneNumber` | `GoalIntent` |
|---|---|---|
| Persian digits `۰۹۱۲` | converted to ASCII | left alone — `۱۰ کیلومتر` is how it is written |
| ZWNJ `U+200C` | **stripped** — incidental keyboard punctuation | **preserved** — a letter-level joiner |
| whitespace | removed | collapsed to single spaces |

The ZWNJ row is the one that matters. In a phone number it is noise a Persian keyboard
inserted. In prose it changes words: می‌روم ("I go") is not میروم, and stripping it makes
the product look like it introduced a spelling error into the athlete's own sentence.
`\s` does not match `U+200C` in JavaScript, so prose survives by default — the comment in
`GoalIntent` exists because the next person to touch it will have just read the
phone-number code, where the rule is reversed.

### Counting characters

`countGraphemes` in the kernel, not `.length` and not code points. Three units get
confused and only the third is what a user means:

- `str.length` — UTF-16 units. `'🏃'` is 2.
- code points — `'🏃'` is 1, but `'👨‍👩‍👧'` is 5, and a Persian letter with a diacritic
  (بَ) is 2.
- graphemes — what is rendered as one thing.

The middle one is a trap because it looks like the fix. It solves the obvious emoji case
and still miscounts vocalised Persian, so an athlete would be told they had used more of
the limit than they had with nothing on screen explaining why. The domain rule and the
on-screen counter call the same function, so they cannot disagree.

### Dates never touch `Date`

The contract carries ISO `date` strings; the application carries `PlainDate`.
`new Date("2026-08-08")` parses as UTC midnight, so in a negative-offset zone it renders
as the 7th — a goal declared on the 8th would display as the day before, and a horizon
would shift by a day for some users and not others. The mapper decomposes the string
arithmetically instead. Outbound, components are zero-padded: `"2027-1-5"` fails the
contract's `format: date`.

Use cases take a `Clock` and a timezone rather than reading the current date. A horizon
rule tested against the real clock passes in March and fails in December — and "today" in
Tehran is not "today" in UTC for several hours a day, which is exactly when someone
declaring a goal late at night would have a horizon rejected for being one day too near.

### Declaring is skippable

A goal declared to get past a form becomes the thing every future prescription and
evaluation is judged against. Arriving without one is better, so onboarding's second step
has a first-class "later" that posts nothing, and an e2e test asserts it posts nothing.
