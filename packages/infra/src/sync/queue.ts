/**
 * The offline mutation queue.
 *
 * The situation this exists for is not an edge case in this product — it is the normal one. An
 * athlete logs sets in a basement gym with no signal, on a phone that may be closed and reopened
 * between sets. So a write has to be accepted immediately, survive the app being killed, and
 * replay later without duplicating.
 *
 * ## The three failure modes, and how each is handled
 *
 * **Transient (network down, 5xx, 429).** Stop the entire drain. Continuing is pointless — the
 * next mutation will fail the same way — and each attempt costs battery and a timeout. The queue
 * is retried on the next connectivity or visibility change.
 *
 * **Permanent (4xx that is not 408/429).** Skip this mutation and CONTINUE. This is the case that
 * is easy to get wrong: a single malformed mutation that always 400s would otherwise block every
 * later log forever, and the athlete would lose a week of training to one bad record. It is moved
 * to the issue log, WITH its payload, rather than deleted.
 *
 * **Already applied (409).** Removed from the queue, and RECORDED as an issue. Replay is
 * at-least-once, so a mutation whose response was lost will be sent twice; the server rejecting
 * the duplicate is the mechanism that makes that safe (D-10). But a 409 can also mean another
 * device logged the same prescribed session first — a genuinely different record — and the
 * athlete has to be told (ADR-0033).
 *
 * ## Why issues are STORED rather than announced
 *
 * An earlier version fired `onConflict`/`onQuarantine` callbacks and nothing subscribed. That is
 * worse than it looks: the drain runs on `online` and `visibilitychange`, which fire when no UI
 * is mounted and sometimes as the app is closing. A callback nobody hears loses the event
 * permanently — so an athlete's log would be silently discarded after the product told them it
 * was saved. The durable record is the mechanism; a callback on top of it is a convenience.
 *
 * ## Ordering
 *
 * Strictly sequential, in id order. Ids are UUIDv7, which sorts chronologically, so replay order
 * is creation order. Draining in parallel would let a later correction land before the log it
 * corrects.
 */
import type { ApiError } from '../http/errors'

/** Bumped when the shape of a queued payload changes. See `migrate`. */
export const QUEUE_SCHEMA_VERSION = 1

export type MutationKind = 'log-session'

export interface QueuedMutation {
  /** UUIDv7. Sorts chronologically, so id order is creation order. */
  readonly id: string
  readonly kind: MutationKind
  readonly payload: unknown
  readonly schemaVersion: number
  readonly createdAt: number
  readonly attempts: number
  readonly lastError: string | null
}

/**
 * Persistence for the queue. A port, so tests run against memory and the browser uses IndexedDB —
 * and so a future platform (a native shell, say) can supply its own without touching this file.
 */
export interface MutationStore {
  readonly enqueue: (mutation: QueuedMutation) => Promise<void>
  readonly all: () => Promise<readonly QueuedMutation[]>
  readonly remove: (id: string) => Promise<void>
  readonly update: (mutation: QueuedMutation) => Promise<void>
  /** Moves the mutation out of the queue and records why. Durable: survives the app closing. */
  readonly recordIssue: (issue: SyncIssue) => Promise<void>
  readonly issues: () => Promise<readonly SyncIssue[]>
  readonly dismissIssue: (id: string) => Promise<void>
}

/**
 * Why a queued mutation never reached the server, in terms the athlete can be told.
 *
 * `conflict`  the server already holds a record for this — usually another device.
 * `rejected`  the server refused it and always will (a permanent 4xx).
 * `gave-up`   too many transient failures.
 *
 * Three rather than two, because they call for different words. "Recorded elsewhere" and "we
 * could not record this" are different things to tell someone about their training.
 */
export type IssueReason = 'conflict' | 'rejected' | 'gave-up'

export interface SyncIssue {
  /** The mutation's own id — client-generated, so it is stable across replays and devices. */
  readonly id: string
  readonly kind: MutationKind
  readonly reason: IssueReason
  /** What the athlete recorded. Kept, always: this is the copy the product must not lose. */
  readonly payload: unknown
  /** What the server holds instead. Conflicts only; null otherwise. */
  readonly existing: unknown
  /** Diagnostic detail — a status code, an attempt count. Never shown to an athlete verbatim. */
  readonly detail: string | null
  readonly at: number
}

export type DrainOutcome = {
  readonly sent: number
  readonly conflicted: number
  /** Recorded as `rejected` or `gave-up` — the log never reached the server. */
  readonly failed: number
  /** True when the drain stopped early because the network is unavailable. */
  readonly stoppedEarly: boolean
}

export interface SyncEngine {
  readonly enqueue: (kind: MutationKind, payload: unknown) => Promise<string>
  readonly drain: () => Promise<DrainOutcome>
  readonly pending: () => Promise<number>
  /** Everything that failed and has not been acknowledged. Drives what the athlete is shown. */
  readonly issues: () => Promise<readonly SyncIssue[]>
  readonly dismissIssue: (id: string) => Promise<void>
}

export interface SyncConfig {
  readonly store: MutationStore
  /** Performs the mutation. Throws `ApiError` or `NetworkError`. */
  readonly send: (mutation: QueuedMutation) => Promise<void>
  readonly newId: () => string
  readonly now: () => number
  /**
   * Attempts before a mutation is given up on rather than retried forever.
   *
   * Applies to TRANSIENT failures only. Permanent failures are recorded on the first attempt —
   * retrying a 400 is a request that will never succeed, and the athlete's battery pays for it.
   */
  readonly maxAttempts?: number
  /**
   * Fired when an issue is recorded, AFTER it is durable.
   *
   * Best-effort and never the mechanism — see the note in the file header on why. Useful for
   * invalidating a query so a mounted UI updates immediately instead of on next poll.
   */
  readonly onIssue?: (issue: SyncIssue) => void
}

const hasStatus = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'status' in error

/**
 * A response the server will give again no matter how many times we ask.
 *
 * 408 (timeout) and 429 (rate limited) are 4xx and are NOT permanent — both explicitly mean "try
 * again". Treating the whole 4xx range as permanent would discard a log purely for arriving
 * during a traffic spike.
 */
const isPermanent = (error: unknown): boolean => {
  if (!hasStatus(error)) return false
  const { status } = error
  if (status === 408 || status === 429) return false
  return status >= 400 && status < 500
}

const isConflict = (error: unknown): boolean => hasStatus(error) && error.status === 409

/**
 * The record the server already holds, when the sender managed to read it.
 *
 * `ConflictError` carries it; a plain `ApiError` does not, because `request` discards the body of
 * any non-ok response. Null is a legitimate answer and the UI handles it — "recorded elsewhere"
 * is still worth saying even when we cannot show what.
 */
const existingFrom = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'existing' in error ? error.existing : null

export const createSyncEngine = (config: SyncConfig): SyncEngine => {
  const maxAttempts = config.maxAttempts ?? 5
  let draining: Promise<DrainOutcome> | null = null

  const enqueue = async (kind: MutationKind, payload: unknown): Promise<string> => {
    const id = config.newId()
    await config.store.enqueue({
      id,
      kind,
      payload,
      schemaVersion: QUEUE_SCHEMA_VERSION,
      createdAt: config.now(),
      attempts: 0,
      lastError: null,
    })
    return id
  }

  const record = async (
    mutation: QueuedMutation,
    reason: IssueReason,
    existing: unknown,
    detail: string | null,
  ): Promise<void> => {
    const issue: SyncIssue = {
      id: mutation.id,
      kind: mutation.kind,
      reason,
      // The athlete's own record, kept whatever happened to it. Storing only the reason would
      // leave them told that something went wrong and unable to see what.
      payload: mutation.payload,
      existing,
      detail,
      at: config.now(),
    }
    // Recorded BEFORE the mutation leaves the queue. The other order loses the log entirely if
    // the app is closed between the two writes — the exact moment a phone in a gym gets closed.
    await config.store.recordIssue(issue)
    await config.store.remove(mutation.id)
    config.onIssue?.(issue)
  }

  const runDrain = async (): Promise<DrainOutcome> => {
    const queued = [...(await config.store.all())].sort((a, b) => (a.id < b.id ? -1 : 1))
    let sent = 0
    let conflicted = 0
    let failed = 0

    for (const mutation of queued) {
      try {
        await config.send(mutation)
        await config.store.remove(mutation.id)
        sent += 1
      } catch (error) {
        if (isConflict(error)) {
          // Already applied. The duplicate is the expected consequence of at-least-once replay,
          // not a problem — but it IS recorded, because a 409 on a session log can also mean
          // another device got there first and the athlete now has two different records of the
          // same session (ADR-0033). Only they can say which one is true.
          await record(mutation, 'conflict', existingFrom(error), null)
          conflicted += 1
          continue
        }

        if (isPermanent(error)) {
          await record(
            mutation,
            'rejected',
            null,
            `permanent: ${hasStatus(error) ? String(error.status) : 'unknown'}`,
          )
          failed += 1
          // CONTINUE, not stop. One malformed mutation must not block every later log.
          continue
        }

        const attempts = mutation.attempts + 1
        if (attempts >= maxAttempts) {
          await record(mutation, 'gave-up', null, `gave up after ${String(attempts)} attempts`)
          failed += 1
          continue
        }

        await config.store.update({
          ...mutation,
          attempts,
          lastError: error instanceof Error ? error.name : 'unknown',
        })
        // Transient: stop the whole drain. The next mutation would fail identically, and each
        // attempt costs a timeout and battery.
        return { sent, conflicted, failed, stoppedEarly: true }
      }
    }

    return { sent, conflicted, failed, stoppedEarly: false }
  }

  /**
   * Single-flight, for the same reason the token refresh is: two concurrent drains would send the
   * same mutation twice. The server's 409 makes that safe rather than corrupting, but it is a
   * wasted round trip on the connection least able to afford one.
   */
  const drain = (): Promise<DrainOutcome> => {
    draining ??= runDrain().finally(() => {
      draining = null
    })
    return draining
  }

  return {
    enqueue,
    drain,
    pending: async () => (await config.store.all()).length,
    issues: () => config.store.issues(),
    dismissIssue: (id) => config.store.dismissIssue(id),
  }
}
