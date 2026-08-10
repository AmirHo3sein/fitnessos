/**
 * The event stream client — handbook D-12.
 *
 * ## What this deliberately does NOT do
 *
 * **It does not implement reconnection.** `EventSource` already does, with its own backoff, and it
 * sends `Last-Event-ID` on every retry without being asked. A hand-rolled reconnect on top would
 * either fight it or duplicate it, and the version that fights it is worse: two loops racing to
 * open a socket produce two streams, and every event then arrives twice.
 *
 * That is the finding the spike was for. The client is small BECAUSE the platform is doing the hard
 * part, and the honest way to record that is to leave the code visibly thin rather than to write a
 * layer that makes it look like work was done.
 *
 * **It does not parse a payload beyond a kind.** An event says what happened; the client's response
 * is always to invalidate a query key and let the normal fetch path produce the data. A stream that
 * carried state would be a second source of truth for everything it touched, and the first
 * disagreement between it and the cache would be undebuggable.
 *
 * ## What it does add
 *
 * Two things `EventSource` has no opinion about, both learned from the matrix:
 *
 *   - **A 401 mid-stream.** `EventSource` cannot see a status code — it reports `onerror` and retries
 *     forever, so an expired session becomes an infinite reconnect loop against a 401. The stream has
 *     to be closed by us and reopened after a refresh, which is what `onSuspectedAuthLoss` is for —
 *     named for what it actually is, because distinguishing a refusal from a drop is a guess.
 *   - **A cap on how long it will keep trying.** A stream that has failed to open many times in a row
 *     is not a transient drop, and continuing to retry a dead endpoint from every open tab is how a
 *     client contributes to an outage rather than surviving one.
 */

export type EventKind = string

export interface StreamEvent {
  readonly kind: EventKind
  /** The id the server assigned. Held only for diagnostics — the browser tracks resume itself. */
  readonly id: string
}

export interface SseOptions {
  /** Same-origin path (ADR-0025), so cookies travel without `withCredentials`. */
  readonly url: string
  readonly onEvent: (event: StreamEvent) => void
  /**
   * Called when the stream has failed repeatedly. NOT called for an ordinary drop — the browser
   * recovers from those on its own and reporting each one would turn a lift ride into an alert.
   */
  readonly onGaveUp?: () => void
  /**
   * A possible session expiry. `EventSource` hides the status code, so this fires on a failure that
   * looks like one — repeated immediate failures with no event in between — and the caller decides
   * whether to refresh. Guessing here is unavoidable and is recorded as such.
   */
  readonly onSuspectedAuthLoss?: () => void
  /** Injected for tests. Defaults to the platform's. */
  readonly create?: (url: string) => EventSource
}

export interface SseHandle {
  readonly close: () => void
  /** Reopen after the caller has refreshed a session. Resumes from the last id the browser saw. */
  readonly reopen: () => void
}

/** After this many consecutive failures with no successful event, stop trying. */
const GIVE_UP_AFTER = 6

/** Failures closer together than this are not a network blip; they look like a refused connection. */
const IMMEDIATE_MS = 1_000

export const openEventStream = (options: SseOptions): SseHandle => {
  const create = options.create ?? ((url: string) => new EventSource(url))

  let source: EventSource | null = null
  let failures = 0
  let lastFailureAt = 0
  let closed = false

  const attach = () => {
    if (closed) return
    const es = create(options.url)
    source = es

    es.onmessage = (message: MessageEvent<string>) => {
      // A successful message clears the failure count. Without this, six drops over a working day
      // would eventually silence a stream that is fine.
      failures = 0
      options.onEvent({ kind: readKind(message), id: message.lastEventId })
    }

    es.onerror = () => {
      const now = timeNow()
      const immediate = now - lastFailureAt < IMMEDIATE_MS
      lastFailureAt = now
      failures += 1

      /*
       * `EventSource` reports `onerror` for both "the connection dropped" and "the server refused
       * it", with no way to tell them apart — no status, no body. Two failures in immediate
       * succession is the closest available signal to a refusal, which in this app almost always
       * means an expired session.
       *
       * This is a heuristic and it is the weakest part of the design. It is here rather than in a
       * comment on a TODO because the alternative — polling an authenticated endpoint to find out
       * whether the session is alive — costs a request per drop on every open tab.
       */
      if (immediate && failures >= 2) options.onSuspectedAuthLoss?.()

      if (failures >= GIVE_UP_AFTER) {
        es.close()
        source = null
        options.onGaveUp?.()
      }
      // Otherwise: do nothing. The browser is already retrying, and closing here would replace its
      // backoff with none.
    }
  }

  attach()

  return {
    close: () => {
      closed = true
      source?.close()
      source = null
    },
    reopen: () => {
      source?.close()
      source = null
      failures = 0
      closed = false
      attach()
    },
  }
}

/**
 * The event's kind, read from the PAYLOAD.
 *
 * Not from an `event:` name, and the server is required not to send one (BACKEND-CONTRACT 5.1). A
 * named frame is delivered to `addEventListener(name)` and never to `onmessage`, so naming events
 * would silence this handler entirely — which is exactly what happened during the spike, with no
 * error anywhere to explain it.
 *
 * Registering a listener per kind is not the escape it looks like: it needs every kind known in
 * advance, and an unknown kind becomes invisible rather than ignored.
 *
 * The fallback return is `message.type` — `'message'` for an unnamed frame — which `isKnownKind`
 * then declines to act on. A frame this cannot read is dropped, not guessed at.
 */
const readKind = (message: MessageEvent<string>): string => {
  try {
    const parsed: unknown = JSON.parse(message.data)
    if (typeof parsed === 'object' && parsed !== null && 'kind' in parsed) {
      // Narrowed by `'kind' in parsed` above, so no assertion is needed — and TypeScript is right
      // that adding one would be noise rather than safety.
      const { kind } = parsed
      if (typeof kind === 'string') return kind
    }
  } catch {
    // A malformed frame is not worth a throw: the response to any event is to refetch, so the worst
    // case of an unrecognised one is a refetch that finds nothing changed.
  }
  return message.type
}

const timeNow = (): number => Date.now()
