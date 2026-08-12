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
 *   - **Closing while the tab is hidden.** Six connections per origin on HTTP/1.1 (measured in the
 *     spike), each stream holding one for its whole life — so four open tabs consume four, and the
 *     tab someone is actually using queues its requests behind three nobody is looking at.
 *   - **Carrying the resume position across a reopen.** See `lastEventId` below; this is the part
 *     that makes pausing safe rather than lossy, and it is not what the platform does for you.
 */

export type EventKind = string

export interface StreamEvent {
  readonly kind: EventKind
  /**
   * Whose data changed (BACKEND-CONTRACT §5.6).
   *
   * ADDRESSING, not entity state: it says whose cache to invalidate and carries no value that could
   * disagree with what the cache holds — which is the property §5.6 protects. Without it a coach
   * watching thirty athletes receives `{"kind":"session-logged"}` and cannot tell whose, leaving only
   * a stream per athlete (which breaks the six-connections-per-origin budget at n=6) or invalidating
   * every subject on every event (the thundering herd §5.6 exists to prevent).
   *
   * `null` when a frame omits it — an older server. The consumer then falls back to its own subject,
   * which is exactly right for a single-subject stream and is what every stream was until now.
   */
  readonly subject: string | null
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
  /**
   * Where "is this tab visible?" comes from.
   *
   * Injected rather than reading `document` directly, because these tests run in the `node`
   * environment — a client that reached for a global would be untestable at the tier that can
   * actually cover its logic. The default reads the real document when there is one.
   */
  readonly visibility?: VisibilitySource
}

export interface VisibilitySource {
  readonly isHidden: () => boolean
  /** Subscribe to changes; returns an unsubscribe. */
  readonly onChange: (listener: () => void) => () => void
}

/**
 * The platform's visibility, or a permanently-visible stand-in where there is no document.
 *
 * Server-side rendering never reaches here — the stream is opened from an effect — but a stand-in
 * that reports "visible" and never fires is the correct degenerate behaviour rather than a throw.
 */
const platformVisibility = (): VisibilitySource =>
  typeof document === 'undefined'
    ? { isHidden: () => false, onChange: () => () => {} }
    : {
        isHidden: () => document.visibilityState === 'hidden',
        onChange: (listener) => {
          document.addEventListener('visibilitychange', listener)
          return () => {
            document.removeEventListener('visibilitychange', listener)
          }
        },
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
  const visibility = options.visibility ?? platformVisibility()

  let source: EventSource | null = null
  let failures = 0
  let lastFailureAt = 0
  let closed = false

  /**
   * The id of the last event seen, carried across every reopen WE initiate.
   *
   * The platform sends `Last-Event-ID` only on `EventSource`'s own automatic reconnect of the same
   * instance. A freshly constructed `EventSource` sends nothing — and there is no API to set the
   * header — so a naive close-and-reopen would arrive at the server with no position at all. Against
   * a server that replays from the beginning, that is not a small bug: it is the entire backlog
   * delivered again, and every event in it invalidating queries.
   *
   * So the id goes on the URL, and the server is required to honour it there as well as in the
   * header (BACKEND-CONTRACT 5.3). This is the piece that makes closing while hidden SAFE rather
   * than merely cheap.
   */
  let lastEventId: string | null = null

  const urlFor = (): string => {
    if (lastEventId === null) return options.url
    const separator = options.url.includes('?') ? '&' : '?'
    return `${options.url}${separator}last-event-id=${encodeURIComponent(lastEventId)}`
  }

  const attach = () => {
    if (closed) return
    // Nothing is opened while hidden. The reopen on becoming visible resumes from `lastEventId`.
    if (visibility.isHidden()) return
    const es = create(urlFor())
    source = es

    es.onmessage = (message: MessageEvent<string>) => {
      // A successful message clears the failure count. Without this, six drops over a working day
      // would eventually silence a stream that is fine.
      failures = 0
      // Recorded BEFORE the callback, so a throw in a consumer cannot lose the position.
      if (message.lastEventId !== '') lastEventId = message.lastEventId
      options.onEvent({
        kind: readKind(message),
        subject: readSubject(message),
        id: message.lastEventId,
      })
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

  /*
   * Pause while hidden, resume when visible.
   *
   * An explicit `close()` wins: `closed` is checked in `attach`, so a handle torn down on unmount
   * cannot be resurrected by a later tab switch. Without that guard the listener outlives the
   * component and reopens a stream nobody owns.
   */
  const unsubscribe = visibility.onChange(() => {
    if (closed) return
    if (visibility.isHidden()) {
      source?.close()
      source = null
      return
    }
    if (source === null) {
      failures = 0
      attach()
    }
  })

  return {
    close: () => {
      closed = true
      unsubscribe()
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

/**
 * The subject a frame concerns, or null when it does not say.
 *
 * Deliberately separate from `readKind` rather than one parse returning both: a frame with a kind and
 * no subject is legitimate (an older server), and a combined reader would have to invent a subject or
 * discard the kind. Null is a real answer here, not a parse failure.
 */
const readSubject = (message: MessageEvent<string>): string | null => {
  try {
    const parsed: unknown = JSON.parse(message.data)
    if (typeof parsed === 'object' && parsed !== null && 'subject' in parsed) {
      const { subject } = parsed
      if (typeof subject === 'string' && subject !== '') return subject
    }
  } catch {
    // Same reasoning as `readKind`: a malformed frame costs a refetch, not a throw.
  }
  return null
}

const timeNow = (): number => Date.now()
