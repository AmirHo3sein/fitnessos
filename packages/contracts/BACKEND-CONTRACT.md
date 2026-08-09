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

### 4.3 `GET /indicators` must derive on read

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

---

## How to check

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
