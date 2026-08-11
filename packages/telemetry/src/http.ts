import type { TelemetryEvent } from './events'
import { guarded, type TelemetryPort } from './port'

/**
 * A sink that posts to OUR OWN API — the decision ADR-0032 left open, taken.
 *
 * ## Why our own API rather than a vendor
 *
 * The residency question under ADR-0002 is what kept this open, and same-origin removes it: nothing
 * leaves the infrastructure that already holds the data these events are about. The closed vocabulary
 * (see `events.ts`) means the payload cannot carry a phone number, an athlete's goal in their own
 * words, or a validator message with a value embedded — so this is not "personal data to a safer
 * place", it is a stream that never contained any.
 *
 * The trade is real and worth stating: no vendor means no grouping, no alerting and no stack
 * symbolisation out of the box. What this buys instead is that production stops being silent, which
 * was the recorded gap, and that switching to a vendor later is a change to one adapter rather than
 * to every call site.
 *
 * ## Everything here exists to stop telemetry hurting the thing it observes
 *
 * A sink runs precisely when the app is unhealthy. So:
 *
 *   - **Batched.** One request per event would turn a render loop that throws into a request flood
 *     against an already-struggling backend.
 *   - **Capped.** The queue drops its OLDEST entries past a limit. Unbounded growth during an
 *     incident is a memory leak in the middle of an incident.
 *   - **Never retried.** A failed flush discards its batch. Retrying telemetry during an outage is
 *     how a client amplifies one.
 *   - **Flushable on the way out**, via a beacon. A crash report that never leaves the device is not
 *     a report. `fetch` on `pagehide` is cancelled by the navigation; a beacon is handed to the
 *     browser and survives it.
 *   - **Silent on failure.** Wrapped in `guarded`, and it logs nothing when the sink itself fails —
 *     a sink that complained about being broken would fill the console it was meant to keep quiet.
 *
 * ## No DOM in here, and the compiler is what said so
 *
 * The first version reached for `fetch`, `navigator.sendBeacon` and `document` directly, and this
 * package's tsconfig refused it — it has no DOM lib, because it is meant to run anywhere. That is the
 * boundary working: batching, capping and never-retrying are pure decisions and belong here; which
 * platform API carries the bytes, and when a page is going away, belong to the app.
 *
 * So `transport` is REQUIRED, and `apps/web/composition/telemetry.ts` supplies it along with the
 * `visibilitychange`/`pagehide` wiring.
 */

export interface HttpTelemetryOptions {
  /** Same-origin path (ADR-0025), so the session cookie travels without CORS. */
  readonly url: string
  /**
   * How many events to hold before sending. Small: these are rare, and a batch that waits for ten
   * would usually be flushed by `pagehide` anyway — which is the one moment where a large batch is
   * most likely to be dropped by a beacon size limit.
   */
  readonly batchSize?: number
  /** Send a partial batch after this long, so a single event is not held indefinitely. */
  readonly flushAfterMs?: number
  /** Hard ceiling on the queue. Past this the OLDEST events are dropped. */
  readonly maxQueued?: number
  /**
   * How a batch leaves the device. Required, not defaulted — see the note above on why this package
   * holds no platform API.
   */
  readonly transport: Transport
}

/**
 * How a batch leaves the device.
 *
 * Two implementations by design: a normal POST while the page is alive, and `sendBeacon` on the way
 * out. Injected as one interface so a test can assert WHICH was used — the distinction is the whole
 * point of the unload path and would otherwise be untestable.
 */
export interface Transport {
  readonly post: (url: string, body: string) => void
  readonly beacon: (url: string, body: string) => boolean
}

export interface HttpTelemetry extends TelemetryPort {
  /**
   * Send whatever is queued now.
   *
   * `viaBeacon` for the page-is-going-away path: the caller owns that event, because knowing a page
   * is unloading is a DOM concern and this module has no DOM.
   */
  readonly flush: (options?: { readonly viaBeacon?: boolean }) => void
  /** Cancel a pending timed flush. Call on teardown so a timer does not outlive its owner. */
  readonly stop: () => void
}

export const createHttpTelemetry = (options: HttpTelemetryOptions): HttpTelemetry => {
  const batchSize = options.batchSize ?? 5
  const flushAfterMs = options.flushAfterMs ?? 5_000
  const maxQueued = options.maxQueued ?? 50
  const transport = options.transport

  let queue: TelemetryEvent[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const send = (viaBeacon: boolean): void => {
    if (queue.length === 0) return
    const batch = queue
    // Cleared BEFORE the send, not after. A transport that throws synchronously would otherwise
    // leave the batch queued and re-send it on the next flush, turning one failure into a growing
    // duplicate stream.
    queue = []
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }

    const body = JSON.stringify({ events: batch })
    if (viaBeacon && transport.beacon(options.url, body)) return
    transport.post(options.url, body)
  }

  const port = guarded({
    report: (event) => {
      queue.push(event)
      if (queue.length > maxQueued) {
        /*
         * Drop the OLDEST, not the newest.
         *
         * During an incident the newest events are the ones describing what is happening now; the
         * hundredth copy of the first error adds nothing. Dropping the newest would mean a queue
         * that fills early and then reports nothing about the rest of the outage.
         */
        queue = queue.slice(queue.length - maxQueued)
      }

      if (queue.length >= batchSize) {
        send(false)
        return
      }
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          send(false)
        }, flushAfterMs)
      }
    },
  })

  return {
    report: port.report,
    flush: (flushOptions) => {
      send(flushOptions?.viaBeacon ?? false)
    },
    stop: () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
