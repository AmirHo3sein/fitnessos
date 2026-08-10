# Runbook

What to do when something breaks, written from failure modes this codebase has **actually produced**
rather than from a list of things that could go wrong. Every entry names how the fault presents,
because in almost every case the symptom was somewhere other than the cause.

There is no deployment section. Rollout, scaling and incident escalation depend on infrastructure
that does not exist yet, and inventing procedures for it would produce a document that reads as
authoritative and is fiction.

---

## The one lever you have without shipping a build

**`FLAG_LIVE_INVALIDATION=off`** — stops the client opening SSE streams. Server-evaluated per
request, so it takes effect on the next page load; no rebuild, no deploy.

Throw it if: reconnect storms, an event flood invalidating queries in a loop, or the backend's
`/events` behaving in any way described in BACKEND-CONTRACT §5 as a silent failure.

What you lose: screens stop updating live. They still refresh on mount and after a save — the
behaviour that existed before the stream did. Nothing breaks; a coach's change reaches an athlete's
open tab on their next navigation instead of within a second.

Verified rather than assumed: `scheduled.yml`'s `kill-switch` job starts the app with the flag off
and asserts no stream is opened and the app still works.

---

## Symptom → cause, for faults with a misleading presentation

### A screen shows "could not be loaded" and a retry

Working as designed. A read failed, and the workspace deliberately does **not** offer to create a new
artefact — because creating one `PUT`s a new id, and "current" is keyed per athlete, so an artefact
that merely failed to load would be replaced by an empty one. That was a real data-loss path
(BACKEND-CONTRACT §4.9).

Check whether the backend answered a transient failure with **204**. It must not: 204 means there is
genuinely nothing, and the client renders the empty state — with a create button.

### An action does nothing at all — no error, no spinner change

Historically this was TanStack Query's `networkMode: 'online'` **pausing** a mutation offline rather
than failing it: `mutationFn` never called, promise never settles, button disabled forever. It is set
to `'always'` globally now, so this should not recur — but the shape is worth recognising, because
nothing errors and nothing logs.

If it does recur, look for a mutation or query created outside the shared QueryClient.

### A verification code arrives minutes after someone gave up

Same cause as above, in its worst form: a paused sign-in fires when connectivity returns. Fixed by the
same global setting.

### An editor's canvas renders two pixels tall, or a whole package looks unstyled

Tailwind lost a source. A class used only inside one `ctx-*` package can vanish from the built
stylesheet while every DOM assertion, the axe audit and 158 e2e tests stay green — assertions read the
DOM and axe does not measure layout.

`visual.spec.ts` is the guard, plus two crude height assertions on the report and workflow canvases.
If those fail, look at `@source` globs in `globals.css` before looking at the component. And note the
recorded correction: the globs were *not* proven to be the original cause; a stale build is the more
likely culprit, so try a clean `.next` first.

### Undo removes more than the user did, or one gesture needs three undos

A dispatch that should have been a batch, or a batch that should have been separate dispatches. The
rule: **a batch never coalesces**, so a burst of arrow-key presses wants coalescing dispatches with a
shared label, while one gesture that moves several nodes wants a batch. Both are asserted in the
editors' tests; the failure is invisible until a user complains.

### A coach's edits vanish after a failed save

Should be impossible: the commit boundary moves only when a save is persisted, and `onSave` returns a
boolean for exactly this. If it happens, look for a builder whose `onSave` resolves `true`
unconditionally.

---

## When CI fails

| Job | What it gates | First thing to check |
|---|---|---|
| `pr.yml` / `verify` | typecheck, lint, boundaries, tokens, contrast, unit + integration + component, **`pnpm audit` at high**, bundle budgets | The step name. Budgets fail with the route and the number; audit failures are usually a transitive dev dependency |
| `pr.yml` / `e2e` | the `@critical` tier only | Reproduce with `pnpm --filter @fitnessos/web e2e:critical` |
| `scheduled.yml` / `e2e-full` | 298 tests including visual regression, in a **pinned container** — 293 pass, 4 kill-switch specs skip by design, 1 is the known mobile-rtl skip | If it is a screenshot: `docs/ci-baselines.md`. Baselines are per platform and both sets are committed |
| `scheduled.yml` / `kill-switch` | the app with `FLAG_LIVE_INVALIDATION=off` | A failure here means the switch no longer works — treat it as urgent, because it is the one lever |
| `scheduled.yml` / `lighthouse` | LCP as an error gate, CLS, console errors, render-blocking | The uploaded `.lighthouseci` artefact has the numbers. Thresholds were set from nine warm runner samples, not from a laptop |

### Two CI traps already paid for

- **A timing test that fails under contention.** Three benchmarks measure a *ratio* with interleaved
  samples and medians, precisely because CI runs several packages at once. If one fails, check whether
  the ratio is near its threshold (contention) or an order of magnitude past it (a real regression) —
  the failure message prints both numbers for that reason.
- **A locator that is ambiguous only sometimes.** `getByRole('alert')` matched one element locally and
  two on CI. Prefer the specific text.

---

## What the backend can break without anyone noticing

`packages/contracts/BACKEND-CONTRACT.md`, 5 sections and 29 numbered requirements. The ones that fail
**silently** — no error on either side, just a client that quietly stops working:

1. Naming SSE frames with `event:` — the client's single handler goes deaf (§5.1).
2. Not writing a prelude byte on connect — `EventSource` sits in CONNECTING forever while `curl`
   works perfectly (§5.2).
3. Ignoring `?last-event-id=` — every tab switch replays the entire backlog (§5.3).
4. Using 204 for a transient read failure — the client shows an empty state with a create button
   (§4.9).
5. Renaming a `detail` string in the workflow vocabulary — stored automations silently change meaning
   (§4.8).

None of these is detectable by the client at runtime. They are contract obligations, and the contract
has still had no reader on the backend side.

---

## Things that are known-missing, not broken

- **Telemetry has no production sink.** ADR-0032 chose the seam and deliberately no vendor; the
  blocker is data residency under ADR-0002, which is a decision rather than engineering. Errors are
  classified and reported to a port that currently drops them in production.
- **Offline app startup does not work** and is untested, because it cannot work without a service
  worker — the document itself cannot be fetched. Logging a session offline *does* work; that is the
  case ADR-0033 was built for.
- **One e2e is skipped on `mobile-rtl`**: Playwright will not click the timeline's undo button after a
  drag while `document.elementFromPoint` returns that button. Unresolved.
- **The Persian copy across seven builders has had no native-speaker review.**
