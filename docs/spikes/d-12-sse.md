# D-12 · SSE spike — findings and decision

**Verdict: adopt SSE.** Four requirements fall on the server, two of which a well-meaning backend
will get wrong by default. One row of the matrix cannot be answered outside production and is left
open rather than assumed.

The evidence is `apps/web/e2e/sse-spike.spec.ts` — kept as tests rather than as a transcript, so the
answers stay true as the stack moves. The client is `packages/infra/src/events/`.

> The architecture repo owns ADRs, and this repo is not it. This file is the spike's report; the ADR
> D-12 asks for belongs beside ADR-0025 and needs a hand that owns that repo.

---

## The matrix, answered

| Row | Result |
|---|---|
| Same-origin `EventSource` | **Pass.** Events arrive. |
| Cross-origin + cookies | **Not tested — pre-resolved.** ADR-0025 puts the API on the same origin, so `withCredentials` and CORS credentials do not arise. |
| Behind a reverse proxy · no buffering | **Half.** Next's own `rewrites()` proxy does not buffer — *once the server writes a prelude byte*. See finding 1. A production proxy is untested. |
| HTTP/2 multiplexing · >6 streams | **Confirmed ceiling.** Six per origin on HTTP/1.1; the seventh never opens. Decides one stream per tab. See finding 4. |
| 30-second drop · reconnect within 5 s with `Last-Event-ID` | **Pass, and better than hoped.** The browser does all of it. See finding 2. |
| Auth expiry mid-stream · clean close, refresh, reconnect | **Fail, at the platform level.** `EventSource` retries a 401 forever. The client must intervene. See finding 3. |

---

## Finding 1 — headers are not flushed until the first body byte

`writeHead` was not enough. With a proxy in the path, `EventSource` sat in `CONNECTING`
indefinitely: no `open`, no `error`, nothing to debug — while `curl` straight at the stub worked the
whole time. That asymmetry is how this class of bug hides.

The fix is one line and is standard practice for exactly this reason: write a no-op comment
(`: open\n\n`) immediately on connect. Any server behind any proxy needs it.

**Consequence:** a required behaviour of the real endpoint, not a stub detail. In the contract.

## Finding 2 — the browser already does reconnection, and better than we would

`EventSource` reconnects with its own backoff and sends `Last-Event-ID` **without being asked**. With
the server replaying from that id, events published while the socket was down arrive afterwards, in
order, with no client-side bookkeeping whatsoever. Measured reconnect: under 5 s, against Chromium's
~3 s default, with no `retry:` field from the server.

So the correct client does *nothing* on error except count failures. A hand-rolled reconnect layer
would race the browser's and open a second socket, and every event would then arrive twice — an
invisible fault, since a duplicated invalidation only doubles fetches.

**Consequence:** `sseClient` is deliberately thin, and a test asserts it does not reconnect, so that
nobody later "fixes" the absence.

## Finding 3 — `EventSource` retries a 401 forever

The platform exposes no status code and no body: a 401 is reported through `onerror`, identically to
a dropped socket, and retried indefinitely. An expired session therefore becomes an endless
reconnect loop against an endpoint that will never accept it, from every open tab, with nothing on
screen to say so.

Nothing fixes this inside `EventSource`. The client has to notice and close the stream itself, then
reopen after a refresh. Distinguishing "refused" from "dropped" is only possible by inference, and
the inference used — two failures in immediate succession — **is a guess**. It is the weakest part of
the design and is marked as such in the code, because the alternative costs an authenticated request
per drop from every tab.

**Consequence:** `onSuspectedAuthLoss`, and a cap (`GIVE_UP_AFTER`) so a dead endpoint is not
hammered by every open tab during an outage.

## Finding 4 — a named `event:` is unhearable by a single-listener client

The sharpest finding, and the one most likely to be reintroduced. A frame carrying `event: foo` is
delivered to `addEventListener('foo')` and **never** to `onmessage`. A server that names its events
silences a client with one handler — which is what the stub did at first, and every row above failed
with no error anywhere.

Registering a listener per kind is not an escape. It requires knowing every kind in advance, which is
the opposite of what a published vocabulary is for, and worse: an unknown kind becomes *invisible*
rather than ignored. `invalidationMap` can only choose to ignore an unrecognised kind if something
delivered it.

**Consequence:** frames carry `id:` and `data:` only, with the kind inside the payload. One
`onmessage`; a newer server adds kinds without a client change.

## Finding 5 — six streams per origin, so one stream per tab

Confirmed by measurement rather than citation: opening eight streams, no more than six reach `OPEN`
and the rest wait indefinitely. Each stream holds a connection for its whole life, so ordinary
requests queue behind them too.

HTTP/2 raises the limit, but it is a deployment property the client cannot rely on.

**Consequence:** **one stream per tab, shared by every context.** `invalidationMap` is what makes one
stream sufficient — the stream says what happened, and the map decides which query keys go stale.

---

## What was NOT built, and why

**The wiring.** `sseClient` and `invalidationMap` exist and are tested; nothing mounts them yet. That
is deliberate at this boundary: findings 3 and 4 change what a sensible wiring looks like, and the
auth-loss path has to meet the HTTP client's single-flight refresh — which is a design conversation,
not a mechanical step. The spike's job was the decision.

**Anything that carries state on the stream.** An event says what happened; the response is always to
invalidate and let the normal fetch path produce data. A stream carrying state would be a second
source of truth for everything it touched, and the first disagreement with the cache would be
undebuggable.

## The row that stays open

Whether the production proxy honours `X-Accel-Buffering: no` and does not buffer a stream. It cannot
be answered here, and a passing local test says only that Next's rewrite behaves. Answer it in
staging with the endpoint live; the failure mode is unmistakable — events arrive in a batch, or not
at all, and `readyState` never leaves `CONNECTING`.
