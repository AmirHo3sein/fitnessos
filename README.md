# FitnessOS

Frontend monorepo. Backend lives in a separate repository (Rust + Axum, ADR-0027).

## Governing documents

The architecture is frozen. Both live in the V1 repository until this repo takes
over documentation ownership:

- **`docs/v2/implementation-handbook.md`** — the implementation contract. Folder
  structure, dependency rules, state boundaries, editor engine spec, testing
  strategy, roadmap.
- **`docs/v2/adr/`** — architecture decision records 0001–0033 (0028 and 0030 still pending).

Deviating from the handbook requires an ADR, referenced by id in the lint rule
that would otherwise block the change. Changes are accepted only when they solve
a proven problem — a benchmark, a failing test, or a production incident.

One document is authored here rather than there:

- **`packages/contracts/BACKEND-CONTRACT.md`** — what the backend must do, in the
  part an OpenAPI schema cannot express. Idempotency, conflict semantics, which
  status codes carry a body, and which distinctions the client depends on being
  real. Every item is something this codebase already assumes, with the failure
  described — the symptom is almost never at the endpoint that caused it.

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
packages/design-tokens  the colour system — generated, contrast-gated (see its README)
packages/editor-engine  document · inverse-action history · spatial index · coordinate spaces
packages/editor-react   React bindings — vanilla store, two channels, useSyncExternalStore
tools/generators      plop generators
tools/color           palette generator + WCAG gate + token-usage lint
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

**377 tests + 78 e2e. All CI stages live.**

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
| phone ending `9` | has a programme; others have none, which is the normal first-run state |
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

## Prescription and Execution

Both are **read-only**, and in both cases the missing write path is a decision rather than
an omission.

**No Program Builder yet**, but `packages/editor-engine` now exists — D-01 history, D-02
document, D-03 spatial index, D-04 coordinate spaces, 38 tests including 1,100 property-test
runs. What remains for a builder is presentation and the React bindings, not the engine.

**Session logging is offline-first** (ADR-0033). See below.

What is proven out is the read path an editor and a logger will sit on: the aggregates, the
invariants, the contract, the mappers, and the ordering guarantees.

### ADR-0008 — two aggregates, not one

`Program` is the **lineage** (mutable, owns which version is current). `ProgramVersion` is
the **structure** (immutable from creation). `revise()` returns a new version and leaves the
input untouched; a test asserts it.

The split exists because a prescription that has been followed cannot be edited. A
`PerformedSession` records what an athlete did against a specific structure — if that
structure could change afterwards, you can no longer tell whether they under-performed or
the target moved.

`ServesGoal` states current purpose and is **never an input to outcome evaluation**. There
is deliberately no function taking a `ServesGoal` and returning anything about success, and
a test guards the absence. Judging a programme by whether its stated goal was reached sounds
obviously right and is wrong: purpose can be restated at any time, which would retroactively
rewrite what the programme is being judged against. Evaluation belongs to the `Hypothesis` on
the authoring record (ADR-0007) and `DecisionOutcome` in Learning.

`AuthoringDecision` keeps `proposedBy` separate from `decidedBy`, because they differ in the
case that matters: an AI-proposed programme accepted by a coach was *decided* by the coach.
Collapsing them loses the only fact that makes ADR-0003 auditable. A revision requires a
fresh decision rather than inheriting one.

### ADR-0021 — screening comes after resolution, before existence

A `PrescribedSession` **cannot be constructed** without a `ScreeningVerdict` covering its
final resolved dose. Not "should have one": the verdict is a required argument and a
`blocked` verdict is refused.

The ordering is the point and is easy to get backwards. Screening an *intent* is worthless —
an intent has no numbers to screen. Only a resolved dose can be checked against a
restriction, so screening happens after resolution and before the session exists. A session
that existed first and was screened afterwards would have a window in which it was
prescribable and unscreened, and that window is where someone gets hurt.

The block check runs **before** structural validation, so a blocked session with malformed
items reports the block. Reporting "sets must be positive" for a session the athlete must not
attempt at all buries the only fact worth acting on.

### Two nulls that mean different things

`ScreeningVerdict.basis` is null in two unrelated cases, and ADR-0002/0014 make the
difference matter: there may be no reason, or there may be a reason the viewer is not
entitled to see. `basisWithheld` distinguishes them, is carried on the wire rather than
inferred, and the UI says *"the reason is not visible to you"* rather than saying nothing —
which would imply the modification was unexplained.

The same shape appears in `loadKg`: absent means **bodyweight**, and never zero. Zero is what
an unresolved progression writes; it reads as a mistake to the athlete and as a valid number
to anything computing volume. The domain refuses it and the mapper normalises absence to
`null`.

### Ordering is an invariant, not a convention

Block and item `order` must be exactly `0..n-1`, each once. This catches the specific bug a
drag-reorder produces — writing back `order` for only the moved element. Nothing throws; the
list just renders in an order nobody chose, differently depending on whether the consumer
sorted stably, and the athlete follows the wrong week.

The first version of that check compared `orders.length` to the expected set size, which are
equal by construction, so `[0, 0]` sailed through. The test caught it. Both the aggregate and
the mapper sort, because the contract promises no order and two clients rendering the same
programme differently is indistinguishable from a data bug.

### Dates in the Persian calendar

`Intl.DateTimeFormat('fa')` selects the Jalali calendar by default. 1405/05/19 and 2026-08-10
are the same day, and showing a Gregorian date to an Iranian athlete is showing them a date
they have to convert in their head. Formatted from the `PlainDate` components in **UTC**,
because the value is a calendar fact with no time and no zone — letting the runtime interpret
it locally is how the 10th becomes the 9th for anyone west of Greenwich.

## Offline logging (ADR-0033)

An athlete logs sets in a basement gym with no signal, on a phone that may be locked between
sets. **This is the normal case for this feature, not an edge case** — which is why the logger
was not built until `infra/sync` existed.

`logSession` resolves when the log is **durable on the device**, not when it reaches the server.
It never awaits the network and never rejects for a network reason. The confirmation says
*"saved, will sync"* rather than *"saved"*, because telling someone in a basement that their
session is on the server is a lie they would discover at the worst moment.

### The three failure modes

| Failure | Behaviour | Why |
|---|---|---|
| Transient — network, 5xx, **408, 429** | Stop the drain, retry later | The next mutation fails identically; each attempt costs a timeout and battery |
| Permanent — 4xx except 408/429 | Quarantine **and continue** | One poison record would otherwise block every later log forever |
| **409** | Treat as success | Already applied. Without this, a lost response poisons the queue permanently |

Replay is at-least-once, made safe by a **client-generated UUIDv7** (D-10) that the server
answers 409 to on a duplicate. Quarantine preserves the record — a mutation that cannot be sent
is still evidence of work someone did.

### Conflict policy: first write wins, loser preserved

Last-write-wins was considered and rejected, because neither available clock can decide which
write is "last": arrival order penalises the device that was offline longer, and client
wall-clock drifts and can be set deliberately. So the server accepts the first log and answers
409 to later ones; the client keeps its copy and surfaces the difference. **Neither side
destroys data**, and the resolution goes to the athlete, who was there.

### Three findings worth knowing

- **TanStack Query's `networkMode: 'online'` default pauses mutations offline.** `mutationFn` is
  never called, `isPending` stays true, and the UI hangs on a disabled button — silently. The
  entire offline design was defeated by a library default that looks unrelated to it. Set
  `networkMode: 'always'` on this mutation only; mutations that genuinely hit the server should
  still pause.
- **A success message inside a component the success handler unmounts renders for zero frames.**
  Transient feedback about a completed action belongs to whatever survives the action.
- **Offline app *startup* is not tested**, because it cannot work without a service worker — the
  document itself cannot be fetched. Durability is covered by unit tests; the e2e proves replay
  on reconnect. Stated rather than implied.

## The editor engine

Seven editors share one engine. It was extracted from the Program Builder's real use rather than
designed up front, which is why its surface is small: everything in it is there because a builder
needed it, and the things a builder turned out not to need were deleted (see *What is absent*).

### The document (D-02)

Flat and normalised, never nested. `nodes` is a record keyed by id; parent/child structure lives in
`childIds`, separately.

That is not a preference, it is why edits are cheap. Immer clones the path it writes to: on a flat
record, setting one property clones one node and one record entry. On a nested tree it clones every
ancestor of the edited node — O(depth) allocation on every keystroke, in a builder where a keystroke
is the most common event there is. The cost is that traversal needs lookups, paid for with memoised
child selectors, and traversal never happens during render.

### History is inverse-action, not snapshot-per-entry (D-01)

A 2,000-node document with 200 undo entries costs kilobytes rather than hundreds of megabytes — but
only if every action can be reversed, so **an action without an inverter must not compile**. The
`ACTIONS` registry is typed `Record<EditorAction['type'], Handler>`; adding a variant to the union
without a handler is a type error at one line. There is no runtime check and no default case.

Inverters **capture state rather than recompute it**. `RemoveNode` carries the removed subtree and
its position: it would be smaller to store the id and recompute on undo, and it would be wrong,
because by the time undo runs the information needed to restore is gone. An inverse is a complete
instruction, not a hint.

| Concern | Rule | Why |
|---|---|---|
| Coalescing | Property edits merge within a window, same type and same targets | Two keystrokes a moment apart are one change; two insertions are not |
| Structural actions | Never coalesce | An undo that removes two nodes when the user expected one is how people stop trusting undo |
| `pushBatch` | Never coalesces, **including a one-action batch** | A batch states "one gesture"; merging it with a neighbour makes undo touch what the gesture never did |
| Commit boundary | Moves only when a save is **persisted** | Moving it on the button press strands a coach whose save failed with edits they can neither retry nor reverse |

### Two channels (`editor-react`)

The committed document and the ephemeral channel — drag offsets, selection — are separate stores
over `useSyncExternalStore`. A drag fires sixty times a second; routing it through the document
would re-render the tree every frame and leave the user needing two hundred undos to reverse one
gesture. So a drag writes to the ephemeral channel and dispatches **once**, on release.

### What is absent, deliberately

`DocumentContract`, `GestureRecognizer`, `InteractionMachine` (reduced to a three-value union), and
`topology/graph` — the last because graph legality is domain knowledge, not engine knowledge (D-11).
`topology/temporal` likewise belongs to `ctx-timeline`. An engine that knew what a trigger was, or
what a training phase was, would be a worse engine.

## The seven editors

All seven ship. Each owns its own document schema (`hydrate`/`commit`, D-09) and its own units — and
the units differ on purpose, because a coordinate space that means the wrong thing is a bug the type
system can catch (D-04).

| Editor | Package | Document unit | Topology | Interaction |
|---|---|---|---|---|
| Programme | `ctx-prescription` | row index | tree | list, keyboard |
| Check-in form | `ctx-measurement` | row index | tree | list, keyboard |
| Report | `ctx-report` | pixels | engine `geometry/*` — spatial hash, snapping, alignment | drag, snap, align — **and arrow keys** |
| Dashboard | `ctx-dashboard` | grid cells | engine `geometry/grid` | drag, displace — **and arrow keys** |
| Timeline | `ctx-timeline` | **day offsets** | `topology/temporal` (context) | drag, resize — **and arrow keys** |
| Nutrition | `ctx-nutrition` | row index, two levels | tree | nested list, re-parenting |
| Workflow | `ctx-workflow` | flow pixels | `topology/graph` (context) | React Flow (D-11) |

### Deviations worth knowing before you touch one

- **Timeline uses day offsets, not milliseconds.** D-04 says milliseconds; a plan is authored in
  weeks and a millisecond offset invites a timezone bug into a domain that has no clock. Recorded as
  a deviation, not an oversight.
- **Workflow stores an edge as a document NODE**, not as a new field on `DocumentSnapshot`. D-11
  named a `ConnectPorts` action; adding it would have changed the shape all six other editors
  hydrate into, plus every property test and the history fuzzer, to gain nothing an edge-as-node
  does not already have. The engine is untouched.
- **Nutrition computes no nutrient totals.** ADR-0012 makes catalogue versioning a prerequisite;
  without it a plan authored today silently changes meaning when a catalogue entry is corrected.
  `amount` holds the coach's words — `'200 g'`, `'a handful'`.
- **The report canvas displaces on overlap; the timeline REFUSES.** Time has no "below" to push a
  phase into, and moving a neighbour would reschedule training the athlete may already have done.
  Same for an illegal graph edge: refused, with a reason, never repaired.
- **Fan-in is legal in Workflow.** Two branches of a condition may converge on one action, which is
  the case a tree cannot hold and the reason that document is a graph.

### Every drag builder is also keyboard-operable

Position and size were pointer-only in Report, Dashboard and Timeline until Phase 6 went looking —
a WCAG 2.1.1 failure at level A that **no automated check can see**: every button was named, every
field labelled, contrast fine. What was missing was not a label but a capability. Arrow keys now
move in each editor's own unit (pixels, cells, weeks), routed through the same domain function the
drag uses, so the keyboard cannot reach a position a drag could not.

The three canvases are `role="application"` — the ARIA-sanctioned way to say the author owns the
keyboard, and what makes arrow keys reach the handler instead of a screen reader's browse mode.

## Live invalidation (D-12)

An event says **what happened**; the client invalidates a query key and lets the normal fetch path
produce the data. Nothing carries state on the stream — that would be a second source of truth for
everything it touched, and the first disagreement with the cache would be undebuggable.

One stream per tab, opened in `AppProviders`, **closed while the tab is hidden**. A browser allows
six connections per origin on HTTP/1.1 and a stream holds one for its whole life, so four idle tabs
would consume four and starve the tab someone is using.

`packages/infra/src/events/invalidationMap.ts` is the vocabulary, as a table rather than as calls
scattered through handlers. An unrecognised kind is **ignored, not treated as "refetch everything"** —
a newer server will publish kinds this build has never heard of.

### Four things the server must do, each of which fails silently if missed

Measured, not assumed — `docs/spikes/d-12-sse.md` has the reasoning and
`apps/web/e2e/sse-spike.spec.ts` the evidence. Full requirements in BACKEND-CONTRACT §5.

| Requirement | What happens if it is missed |
|---|---|
| Frames carry `id:` and `data:` only — **never `event:`** | A named frame goes to `addEventListener(name)` and never to `onmessage`. An unknown kind becomes *invisible*, not ignored |
| Write a prelude byte on connect | Headers are not flushed through a proxy until the first body byte. `EventSource` sits in `CONNECTING` forever while `curl` works perfectly |
| Honour the position from the header **and** `?last-event-id=` | The browser sends the header only on its own automatic reconnect. Any client-initiated reopen — every tab switch — arrives with no position and is replayed the entire backlog |
| Refuse an unauthenticated stream promptly | `EventSource` hides the status code and retries a 401 forever, from every open tab, with nothing on screen |

The last one has no fix inside the platform: the client infers refusal from two immediate failures
and closes the stream itself. That inference **is a guess**, marked as one in the code.

## State of play

Phases 0–6 are done: all seven editors, strict CSP, AA on every builder including keyboard
operability, bundle budgets per route, Lighthouse on the public routes, offline logging, and live
invalidation. `pnpm check` is the gate; `pnpm e2e:full` is 294 tests across a chromium and a mobile-RTL
project — 293 passing and one skipped, described at the end of this section.

What is **not** done, and what each waits on:

### Offline is a per-mutation decision, and the default was wrong for all of them

`networkMode: 'always'` is set globally on the QueryClient. TanStack Query's default, `'online'`,
does not fail when the browser is offline — it **pauses**: `mutationFn` is never called, the promise
never settles, and a save button sits disabled with nothing on screen. Twelve mutation sites were
affected, including sign-in, and every query with no cached data showed its skeleton forever.

The exception is session logging (ADR-0033), which sets the same value for the opposite reason:
not "fail fast so the author can retry" but "never consult the network — this writes to a durable
queue". An authored artefact must fail while its author is looking at it; a session log must not.

| Open | Waits on |
|---|---|
| Persian copy across seven builders | A native speaker. None of it has been reviewed |
| `BACKEND-CONTRACT.md` — 5 sections, 29 numbered requirements | A reader on the backend side. This client agreeing with its own stub proves consistency, not correctness |
| Telemetry sink (ADR-0032) | Deployment and the data-residency question under ADR-0002 — not engineering |
| D-12's proxy row | Staging, with the endpoint live. Whether the production proxy honours `X-Accel-Buffering: no` cannot be answered locally |
| Authenticated Lighthouse metrics | A decision to take on `puppeteer`. See the note in `lighthouserc.cjs` — the header-based shortcut silently measures a redirect |
| ADRs 0028, 0030 | The backend repository |

One e2e is skipped on `mobile-rtl`: Playwright refuses to click the timeline's undo button after a
drag, reporting that the toolbar intercepts pointer events on its own child, while
`document.elementFromPoint` at that position returns the button. Unresolved, recorded as unresolved.
