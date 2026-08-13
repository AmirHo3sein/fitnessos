# What the backend must do

`spec/openapi.json` is the contract (ADR-0026). This document covers the part a
schema cannot express: **behaviour**. Status codes, idempotency, what a body means
when it arrives with a particular code, and which distinctions the client depends
on being real.

Everything here is something the frontend already assumes. Where an assumption is
wrong, the failure is described — because in almost every case the symptom appears
somewhere other than the endpoint that caused it, which is what makes these worth
writing down rather than discovering.

Sections 1 and 2 are blocking. Section 3 is behaviour the client relies on today.
Section 4 lists gaps in the contract itself, which are ours to fix, not yours.

---

## 1 · Idempotency: client-generated ids

ADR-0010: the client generates the id of everything it creates, including offline,
using UUIDv7. This is not a convenience — it is the only reason a write can be
retried safely.

### 1.1 `POST /sessions/performed` — 409 on a duplicate `id`

**Required.** A body whose `id` is already stored MUST return **409** with the
stored `PerformedSession` as the body. It must never create a second record, and
must never return 201.

**Why.** Offline replay is at-least-once. A log written in a basement gym is queued
on the device; when the connection returns, the queue drains. If the response to
the first attempt is lost — which is the ordinary case on a phone regaining signal
— the same body is sent again. The 409 is what makes the second attempt harmless.

**What breaks without it.** Every recovered-from-network-loss log becomes a
duplicate session. The athlete's history shows sets they did once as sets they did
twice, and the derived indicators built on that history are wrong in a way nobody
can trace back to a lost HTTP response weeks earlier.

**The body matters.** The client reads it to show the athlete what the server
already holds. A 409 with an empty body is accepted and degrades — the athlete is
told their log collided and cannot be shown with what.

### 1.2 `POST /sessions/performed` — 409 when another device logged first

**Required.** A body with a NEW `id` but a `prescribedSessionId` that already has a
log MUST return **409** with the stored record. First write wins.

**Why.** Two devices, one session. The server cannot know which record is true, and
neither can the client — only the athlete can. So the server refuses the second,
returns the first, and the client surfaces both and waits.

**Note this is a different case from 1.1** and both must return 409. The client
does not distinguish them, deliberately: from the athlete's side, "already
recorded" is one fact.

### 1.3 `POST /observations` — 200 on a duplicate `id`

**Required.** A body whose `id` is already stored MUST return **200** with that record, never a
second one.

**Why the difference from 1.1.** A duplicate measurement can only be a retry. Nobody records
the same bodyweight twice by accident on two devices in the way they might log the same session
twice — so unlike a session log, there is nothing here worth telling the athlete about, and the
replay should be indistinguishable from success.

### 1.4 `POST /programs/{programId}/versions` — 200 on a duplicate `id`

**Required.** A body whose `id` matches a version already stored MUST return
**200** with that version. Not 409, and not a second version.

**Why the difference from 1.1.** A replayed session log and a replayed revision are
both retries, but the desired outcome differs. A duplicate session log is worth
telling the athlete about, because it may be a genuine second record from another
device. A duplicate revision is only ever a retry of the same request — nobody
authors an identical version twice by accident — so it should be indistinguishable
from success.

**What breaks without it.** A coach whose save times out presses save again. Two
versions are created from one intent, the version number jumps by two, and the
athlete's programme has a phantom revision in its history.

---

## 2 · Concurrency

### 2.1 `POST /programs/{programId}/versions` — 409 on a stale `baseVersionId`

**Required.** If `baseVersionId` is not the programme's current version, the
request MUST be refused with **409**, and the body MUST be the `Program` as it
stands now.

**Why.** A coach may have a builder open for an hour. Locking for an hour is not an
option, so this is optimistic concurrency: the client says what it edited from, and
the server refuses if the world moved.

**What breaks without it.** The last save wins silently. Two coaches editing one
programme, and one of them loses their work with no error and no trace — the worst
available outcome, because nothing anywhere records that it happened.

**The body matters here more than anywhere else.** The client shows the author what
they collided with (ADR-0033). Without a body it can only say that something went
wrong, which is a conflict nobody can resolve.

### 2.1a The same rule, for the other six artefacts

**Required, and new (ADR-0035).** `PUT /{artefact}/{id}` — check-in forms, dashboards, nutrition
plans, plans, reports, workflows — MUST carry `baseRevision`, the `revision` the client last read.
A mismatch, or its absence against an artefact that already exists, MUST be refused with **409**
carrying the artefact as it now stands.

**Why this was missed.** §2.1 was written for programme versions because a programme was the only
artefact two people could plausibly edit. The other six were `PUT` with no precondition, which is safe
while there is exactly one author — you cannot collide with yourself — and becomes last-write-wins the
moment there are two.

ADR-0033 already rejected that resolution, for a reason that applies here unchanged: *"last-write-wins
was rejected because neither available clock can decide which write is last"*.

**What breaks without it.** A coach and an athlete edit one nutrition plan. One silently overwrites
the other. Nothing anywhere records that it happened, and the athlete follows a plan their coach did
not write — §2.1's stated worst outcome, arriving through the six endpoints §2.1 did not cover.

**A first save carries no `baseRevision`**, because there is nothing to collide with.

**§4.9 and this rule meet, and the interaction is not obvious.** "PUT to an unknown id CREATES" is
about there being nothing CURRENT — not about the id being new. When an artefact is already current, a
PUT with a new id REPLACES it (that is §4.9's own data-loss path), and replacing still needs the
revision being replaced. So: no `baseRevision` is correct only against a 204, and a new id against an
existing artefact is a collision like any other.

`GET /{artefact}/current` therefore returns `revision` alongside `id`, and an accepted `PUT` returns
the new one — so a client can save twice in succession without re-reading.

### 2.2 `POST /auth/refresh` — strict rotation, and what that obliges

The spec already says rotation is strict: the presented token is revoked. Two
consequences the client has already implemented, recorded here so they are not
"fixed" from the other side:

- **Concurrent refreshes are serialised client-side.** N simultaneous 401s do not
  produce N rotations. The client runs a single in-flight refresh and every caller
  awaits it. If the server ever tolerated concurrent rotation instead, this would
  still be correct.
- **The server never refreshes.** An RSC render cannot deliver `Set-Cookie` to the
  browser, so a server-side rotation revokes the old token and discards the new
  one — a silent logout on the next navigation. Server-mode requests let a 401
  propagate.

---

## 3 · Semantics the client depends on

These are already in the spec, in one form or another. They are collected here
because each is easy to implement in a way that satisfies the schema and breaks the
product.

### 3.1 `null` is not the same as absent

The client normalises at the mapper boundary, so a wrong choice here does not throw
— it renders differently, compares differently, and serialises differently three
layers away.

| Field | Contract | Meaning of absent |
|---|---|---|
| `ProgressionIntent.ratePercent` | optional, `> 0` | not a linear block. **Never send `null`** — it fails the constraint |
| `PrescribedItem.loadKg` | optional, `> 0` | bodyweight. **Never `0`** |
| `ServesGoal.rationale` | optional | no reason was written |
| `TrainingIdentity.trainingAgeMonths` | optional | the athlete left it blank |

### 3.2 `GET /programs/current` — 204 for no programme

**204, not 404.** Having no programme is the normal state of a newly-onboarded
athlete, not an error. A 404 puts an error boundary in the path of the most common
first-run experience.

### 3.3 403 and 404 are different answers

The client distinguishes them and shows different words. A goal that was deleted
and a goal belonging to an athlete this coach may not see are different facts about
the world (ADR-0002 / ADR-0014), and collapsing them into "unavailable" tells a
coach something untrue about a goal that still exists.

**Do not** return 404 for a resource that exists but is forbidden. The usual
argument for doing so — avoiding existence disclosure — does not apply within an
engagement the caller is already party to.

### 3.4 `ScreeningVerdict.basisWithheld` must be honest

`basis` absent has two meanings, and `basisWithheld` is the only thing that
separates them: there was no reason, versus there is a reason and this viewer may
not see it. The athlete is told "modified, and the reason is not yours to see"
rather than being left to infer that the modification was unexplained.

Sending `basisWithheld: false` when a basis exists but was filtered is a
consent-disclosure failure, not a display bug.

### 3.5 Ordering is not promised, and the client does not rely on it

`ProgramVersion.blocks` and `PrescribedSession.items` are sorted client-side by
`order`. The server may return them in any order — two clients rendering the same
programme differently is indistinguishable from a data bug, so the client does not
trust the wire order either way.

`order` within a version SHOULD be exactly `0..n-1`, each once. The read path
tolerates a gap or a duplicate deliberately: refusing would make the programmes
that most need fixing the ones a coach cannot open. The Program Builder derives
`order` from position, so any save normalises it. The write path does refuse
non-contiguous input, which means a client that constructed one gets a validation
error before the request is sent.

### 3.6 Tolerant reader, strict writer

Read models accept whatever is stored, including records written before a rule
existed. **Adding a field to a response is not a breaking change.** Removing one,
renaming one, or narrowing an enum is.

The client's write path is the opposite: request bodies are validated against the
spec before being sent, so a request that violates the schema never leaves the
device.

### 3.7 Same-origin API

ADR-0025 puts `/api/v1` on the same origin behind a reverse proxy. The Content
Security Policy sets `connect-src 'self'` on that basis. If the API ever moves to a
different origin, **every request in the application is refused by the browser**,
silently, as pages that never load their data. That is a coordinated change, not a
deployment detail.

### 3.8 `retryAfterSeconds` is server-authoritative

The client does not compute its own cooldown after `POST /auth/request-code`. Two
clients disagreeing about a rate limit is how a user gets told to wait when they
need not, or invited to retry into a 429.

---

## 4 · Gaps on our side

Recorded so they are not mistaken for backend omissions.

### 4.1 `ServesGoal` carries no label

A programme's `servesGoal` is a cross-document reference (handbook D-08), and D-08
requires every reference to carry a `fallbackLabel` — the only renderable content
when the target is gone or forbidden. `ServesGoal` has `goalId` and an optional
`rationale`, and no label.

Today the client falls back to the rationale, which is the document's own words
about *why* it points there and is the most meaningful thing still readable when
the goal is gone. Where no rationale was written, there is genuinely nothing and a
localised placeholder says so.

**This is a frontend-authored spec change when it happens, not a request.** Noted
because the workaround is load-bearing.

### 4.2 Not needed yet

- **SSE.** The handbook's D-12 spike and Phase 3 event-driven invalidation need an
  event endpoint with `Last-Event-ID`, plus a separate assistance stream. Auth is
  cookie-based, because `EventSource` cannot set headers. Nothing is built against
  these yet and nothing should be until one exists to build against.
- **File upload.** Signed-URL direct-to-storage (handbook Part 5). The contract is
  a Phase 1 deliverable and has not been authored; the implementation is Phase 4.

### 4.3 `POST /proposals/{id}/outcome` must preserve what it supersedes

**Required.** A verdict correction supplies `supersedes` and creates a NEW outcome. The
superseded one MUST remain readable from `GET /outcomes`. It is not deleted, not flagged, and
not filtered out server-side.

**Why.** ADR-0007: a verdict is evidence, and editing one in place would rewrite what was
concluded at the time — the only thing that makes a later disagreement legible. A correction
that hid what it replaced would make the correction itself invisible, which is the opposite of
the rule's purpose.

The client follows the supersede chain to decide what is still unanswered, so hiding superseded
outcomes would also make a corrected proposal read as never judged.

### 4.4 Accepting a proposal is not a Learning endpoint

There is deliberately no `POST /proposals/{id}/accept`. ADR-0010 places the moment of change in
the CHANGING context: accepting produces a new `ProgramVersion` whose `authoringDecision` records
`proposedBy: 'assistant'` and `decidedBy: <the human>`. The proposal's `accepted` and `decidedOn`
fields are reported back to Learning as a consequence, not written by it (ADR-0019).

If an accept endpoint appears under `/proposals`, that is Learning writing another context's
model, and the boundary is gone.

### 4.5 `PUT /check-in-forms/{id}` is a replace, and that is deliberate

A check-in form is **not versioned**, unlike a `ProgramVersion`. Observations reference an
indicator KIND, not a field id, so editing a form cannot make an existing observation
unreadable — which is the entire reason programme versions are immutable.

So this is a `PUT` with no client-generated request id and no conflict handling: submitting the
same body twice must leave the form in the same state, and that is what makes a retry safe.

**Do not** add versioning here by analogy with programmes. It would create a second immutable
lineage nothing reads, and it would push the client into idempotency-key handling it does not
need.

### 4.6 `GET /indicators` must derive on read

Not a gap — a requirement stated here because it is the one thing about Measurement a schema
cannot express, and the one thing most likely to be "optimised" away.

There must be **no indicator table**. ADR-0006: staleness, trends and derivations are queries,
not state. `GET /indicators` computes its answer from stored observations and performed sessions
each time it is asked.

The consequence a caching layer would break: **logging a session changes this response, with no
observation recorded**. That is ADR-0024's cycle — Execution feeds Measurement feeds Prescription
— and it is asserted end to end in `shell.spec.ts` ("the loop closes"). A stored indicator would
be correct until the first session was logged and silently stale thereafter, and the athlete
would see their estimated one-rep max fail to move after the session that moved it.

### 4.7 `NutritionPlan` nests, and both levels have rules

The only nested document in the API, which makes three things worth stating explicitly rather
than leaving to a reader's inference from the schema:

**`MealItem.id` is unique across the whole plan, not within its meal.** These are node ids in the
editor's flat document, so two items in different meals sharing an id would be one node with two
parents. The editor cannot represent that, and a plan carrying it will fail to hydrate rather than
render half of itself. If ids are generated server-side for any reason, generate them per plan.

**`order` is zero-based within its own meal**, so two meals each holding two items both use `0, 1`.
The same tolerance as §3.5 applies at both levels: the read path sorts and tolerates a gap, the
write path refuses one. The builder derives `order` from position at both levels, so any save
normalises the whole plan.

**`amount` is free text and must stay that way for now.** `'200 g'`, `'1 cup'`, `'a handful'` are
all legitimate. A `{ quantity, unit }` pair would be the better shape and it is not available yet:
it presumes a unit vocabulary, which presumes the food catalogue, and ADR-0012 makes catalogue
**versioning** a prerequisite because a plan authored today must not change meaning when a
catalogue entry is corrected. Until that exists, this field holds the coach's words and the client
computes no totals from it. A backend that starts parsing it into numbers will be the first thing
to break when the catalogue lands, because the parse will disagree with the catalogue's units.

`PUT /nutrition-plans/{planId}` is a replace, on the same reasoning as §4.5: nothing references a
meal or an item, so replacing the plan cannot make anything else unreadable.

### 4.8 `Workflow` — an enabled automation must be runnable, and the server has to check

The only stored artefact whose contents change what the SERVER does. A nutrition plan that is
half-written is a half-written document; a workflow that is half-written and `enabled` is something
the runner will act on.

**Required check on `PUT /workflows/{workflowId}`:** if `enabled` is true, refuse with 400 unless

  - at least one node has `kind: "trigger"`, and
  - every node is reachable from some trigger by following edges.

The client refuses this too, in `ctx-workflow`'s `topology/graph`, and that is not a reason to skip
it. A client-side guard protects a coach from a mistake; a server-side one protects the runner from a
client — including an older client, a replayed request, or a bug in the enable button. The stub in
`tools/stub-api` implements exactly these two conditions, deliberately in its own code rather than by
importing the client's rule, because a check that agrees with the client by construction proves
nothing.

**What the server does NOT need to enforce**, because the graph cannot be authored otherwise and a
stored violation is a data problem rather than a request to reject:

  - acyclicity. `canConnect` refuses an edge that would close a loop, one edge at a time, and a
    property test asserts that no sequence of individually-legal edges can produce a cyclic graph.
  - one edge per output port. Same argument.
  - no edge into a trigger. The UI renders no target handle on one at all.

If the server wants a second opinion on any of these, a topological sort answers all three at once.

**`detail` is the runner's vocabulary, not the client's.** The client stores whatever string it is
given and renders it verbatim, deliberately: duplicating the list of trigger events and action kinds
here would create a second copy to keep in step, and a workflow authored against a newer server would
render blanks instead of words. The consequence for the server: **`detail` values must be stable**.
Renaming one silently changes what a stored workflow says it does.

**Coordinates are layout, not semantics.** `x`/`y` may be any finite number, including negative — a
canvas has no origin corner. Two workflows differing only in coordinates behave identically, so
nothing may be derived from them.

### 4.9 A failed READ must be distinguishable from "nothing authored"

Not a request of the backend so much as a consequence of one, recorded because the backend's shape
is what made the client bug possible and a change there could reintroduce it.

Six authoring screens treated a failed `GET /{artefact}/current` exactly as they treated a 204: the
workspace received `null` either way, rendered "nothing has been written yet", and offered a Create
button. Pressing it `PUT`s a **new id** — and because "current" is keyed per athlete rather than by
id, the artefact that had merely failed to load was replaced by an empty one. A dropped request
became data loss.

The client now distinguishes them and never offers to create over a read it could not complete. Two
obligations follow for the server:

  - **204 means there is genuinely nothing**, and must not be used for a transient failure. A 503 or
    a 500 is the honest answer to "I could not read it", and the client shows a retry for those.
  - **`PUT /{artefact}/{id}` with an unknown id creates.** That is what makes the above a data-loss
    path rather than a 404, and it stays that way because ADR-0010's client-generated ids require it.
    If a server ever wants to refuse creation on PUT, say so before it ships: the client would need a
    different flow, not a different error message.

---

## 5 · The event stream (`GET /events`)

Written from measurements, not from the specification: `apps/web/e2e/sse-spike.spec.ts` is the
evidence and `docs/spikes/d-12-sse.md` the reasoning. Two of the four requirements below are things a
well-meaning implementation gets wrong by default, and each one fails **silently** — no error on
either side, just a client that never hears anything.

### 5.1 Frames carry `id:` and `data:` only — never `event:`

A frame with `event: foo` is delivered by the browser to `addEventListener('foo')` and **never** to
`onmessage`. A server that names its events silences a client with one handler, and there is no error
anywhere to explain it.

Naming forces the client to register a listener per kind, which means knowing every kind in advance —
the opposite of a published vocabulary — and makes an unknown kind *invisible* rather than ignored.

So: **the kind goes in the payload.**

```
id: 1428
data: {"kind":"programme-revised"}

```

### 5.2 Write a prelude byte immediately on connect

`: open\n\n`, before anything else. Response headers are not flushed to the browser until the first
byte of body arrives through a proxy, so without it `EventSource` sits in `CONNECTING` indefinitely —
no `open` event, no error, and `curl` against the origin server working perfectly the whole time.

Send `X-Accel-Buffering: no` as well, and `Cache-Control: no-cache, no-transform`.

### 5.3 Every frame needs a monotonic `id:`, honoured from the header **and** the query string

The browser sends the last id it saw back as `Last-Event-ID` on every reconnect, unprompted. A server
that ignores it turns each reconnect into a **silent gap**: the events between the drop and the
recovery are lost and nothing on either side notices.

**It must also be accepted as `?last-event-id=<id>`, and this is not a convenience.** The browser
sends the header only on `EventSource`'s OWN automatic reconnect of the same instance. Any reopen the
client initiates constructs a new `EventSource`, which sends no header and offers no API to set one —
and this client does initiate reopens: it closes the stream while the tab is hidden, because a browser
allows six connections per origin and four idle tabs would consume four of them.

Ignoring the parameter does not degrade gracefully. Every deliberate reopen would arrive with no
position and be replayed the entire backlog, each event of it invalidating queries — on every tab
switch. Both spellings, same replay semantics; the header wins if both are present.

**The id is OPAQUE.** Event ids are monotonic per ATHLETE — that is what closes the silent gap, since a
global sequence hands out its number before commit and can make 42 visible before 41 — so a stream
covering several athletes has several sequences and one `Last-Event-ID`. The wire id therefore encodes
a position per subject. A single-subject stream still emits a bare integer, and the server accepts both.

Nothing was ever entitled to read it as a number: the browser echoes back whatever the last frame's
`id:` said, verbatim, and offers no way to construct one. The requirement is *no silent gap*, not *an
integer*.

**An unreadable position is `resume-impossible`, not a fresh start.** Starting over replays the whole
window, every event of it invalidating queries; starting from now skips it silently. The same applies
when a position names a subject the stream no longer carries — an engagement that ended between
reconnects — and when only SOME positions are still honourable: a partial resume would lose the frames
for the rest with nothing saying so.

A capped replay window is fine. If a `Last-Event-ID` is older than the window, say so distinctly — a
frame the client can recognise as "resume impossible" — so the client can refetch everything instead
of assuming it is up to date. **Do not** silently resume from the newest event; that is the same
silent gap with extra steps.

**The `resume-impossible` frame must carry an `id:` of its own, and the stream must NOT close after
it.** Both halves are load-bearing, and getting either wrong turns one refetch into a permanent loop.
`EventSource` reconnects whenever a stream ENDS, reusing the URL it was constructed with — which
carries `?last-event-id=` — and a frame with no `id:` leaves the browser's last-event-ID buffer
untouched (WHATWG), so the header repeats too. The same unhonourable position then comes back every
~3s from every open tab, each round-trip invalidating every query in the client's cache; and a
delivered frame resets the client's failure count, so nothing ever gives up.

So the frame names a position that IS honourable — the current head — and the stream carries on from
it. Where no subject has issued anything yet, the `id:` is present and EMPTY, which sets the browser's
buffer to the empty string and suppresses `Last-Event-ID` entirely on the next reconnect. A client
must treat an empty id the same way: forget the position rather than ignore the field.

**A stream re-resolves who it carries.** Access is resolved per request everywhere else, and a stream
is one request that lasts hours — so a subject set resolved only at connect makes the stream the one
place revocation does not reach: `GET /athletes/{id}` refuses immediately while the open stream goes
on announcing that athlete's activity for as long as the tab stays open. Re-resolve at least once per
poll interval, forget the positions of anyone dropped, and start anyone newly granted at THEIR current
head rather than at the start of the window.

**The wire id's shape is decided by the STREAM's subject count, not the cursor's.** A stream carrying
two athletes, only one of whom has emitted anything, holds one position — and collapsing on that count
emits a bare integer, which names no athlete and cannot be attributed on reconnect. The answer is then
`resume-impossible` on every reconnect, silently, until the second athlete happens to act.

### 5.4 A 401 on the stream must be a 401 on the stream

The client cannot see a status code — `EventSource` reports every failure identically and retries
forever, so an expired session becomes an endless reconnect loop from every open tab. The client
detects this by inference and closes the stream itself, which works only if refusal is prompt and
consistent. Do not hold an unauthenticated stream open, and do not accept it and then send nothing.

### 5.5 Budget one stream per tab

A browser allows six connections per origin on HTTP/1.1, and a stream holds one for its whole life;
the seventh never opens and ordinary requests queue behind it. The client therefore opens **one**
stream per tab regardless of how many contexts want events. Plan for concurrency on that basis: an
athlete with three tabs open is three streams, not three per context.

### 5.6 Events name what happened and whose, and carry nothing else

```
id: 1428
data: {"kind":"session-logged","subject":"019ff…"}
```

**`subject` is required, and it is ADDRESSING rather than entity state.** It names whose cache to
invalidate and carries no value that could disagree with what the cache holds — which is the property
this section actually protects. Without it a coach watching thirty athletes receives
`{"kind":"session-logged"}` and cannot tell whose, leaving two options and both are worse: a stream per
athlete, which breaks §5.5's six-connections-per-origin budget at n=6, or invalidating every subject on
every event, which is the thundering herd this section exists to prevent.

The client falls back to its own subject when a frame omits it, which is correct for a single-subject
stream and is what every stream was before coaching existed.

The client's response to any event is to invalidate a query key and refetch. Do not put entity state
in a frame: it would be a second source of truth for everything it touched, and the first
disagreement with the cache would be undebuggable. The vocabulary the client acts on is in
`packages/infra/src/events/invalidationMap.ts`; an unrecognised kind is deliberately ignored rather
than treated as "refetch everything", so adding a kind is safe and renaming one is not.

### 5.7 `POST /telemetry` — cheap, and never the reason a request is slow

The client is fire-and-forget by contract: it does not await the response, does not read it, **never
retries**, and drops a batch it could not send. That makes this endpoint unusual in both directions.

**Answer 202 and store asynchronously.** Nothing is returned because nothing is read. If persisting is
slow, persist later — a telemetry write that blocks is a client that is slowest exactly when it is
already unhealthy.

**At most 50 events per batch.** The client caps its queue and drops the OLDEST past that, so a longer
body is a client bug rather than something to accommodate.

**Do not add a free-form field.** The vocabulary is closed (`packages/telemetry/src/events.ts`) so that
a phone number, an athlete's goal in their own words, or a validator message with a value embedded
*cannot* reach you. A `metadata` map or a `message` string would undo that in one commit, and the
reason it is closed is ADR-0002's residency position: the events are stored here precisely because
they contain nothing that needed a residency decision.

**Expect nothing from an unhealthy client.** Silence is a signal, not a bug: a client that cannot reach
you also cannot tell you so.

---

## How to check — run it

`pnpm conformance` executes the requirements that are observable from outside a single request. It
needs a base URL and a disposable account:

```sh
CONFORMANCE_BASE_URL=https://api.example.test/api/v1 \
CONFORMANCE_COOKIE='access_token=…' \
pnpm conformance
```

Thirteen checks, each naming its section, so a failure is a line in this document rather than a
puzzle. It covers all five requirements that fail **silently** (§5.1–5.4, §4.9) plus idempotency and
concurrency (§1.1, §1.3, §1.4, §2.1) and the 403/404 distinction (§3.3).

Every check is probe-verified: the stub was deliberately broken in seven ways — naming SSE frames,
dropping the prelude byte, ignoring `?last-event-id=`, accepting an unauthenticated stream, 404ing a
PUT to an unknown id, answering 200 to a duplicate session, accepting a stale `baseVersionId` — and
each break was caught by the check that names it. A suite nobody has broken on purpose is a suite
nobody knows works.

What it cannot check is listed in `tools/conformance/README.md` with the reason, so "passes" and "not
checked" are never confused: §3.5 (ordering is not promised, so nothing can be asserted), §3.7 (a
deployment property), §4.1 and §4.2 (statements about what the client does not need).

## How to check — read it

The stub in `tools/stub-api` is the executable form of most of this document, and
the e2e suite asserts against it. Where the prose and the stub disagree, one of
them is wrong — say which, rather than quietly matching the prose.

Covered by the stub and exercised end to end:

- §1.1, §1.2 · both `POST /sessions/performed` conflicts, with the stored record
- §1.3 · replayed revision returns 200
- §2.1 · stale `baseVersionId` returns 409 with the current programme
- §3.2 · 204 for an athlete with no programme
- §3.5 · blocks are served deliberately out of order, so the client's sort is
  exercised rather than assumed

**Not covered by the stub**, and therefore not verified anywhere:

- §3.3 · the stub never returns 403, so the forbidden-versus-deleted distinction
  is asserted only in the reference resolver's integration tests, against a
  fabricated 403. If the real backend returns 404 for a forbidden goal, nothing
  here catches it.
- §3.4 · the stub always sends `basisWithheld: true` for its one modified
  session, so the `false` path has no end-to-end coverage.
- §2.2 · rotation is stubbed as always succeeding; token revocation is not
  modelled.
