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
 * to quarantine, where it can be inspected, rather than deleted.
 *
 * **Already applied (409).** Treat as SUCCESS. Replay is at-least-once, so a mutation whose
 * response was lost will be sent twice; the server rejecting the duplicate is the mechanism that
 * makes that safe (D-10: every POST body carries a client-generated UUIDv7 and the server returns
 * 409 on collision). Without this branch, a lost response would poison the queue permanently.
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
  readonly quarantine: (mutation: QueuedMutation, reason: string) => Promise<void>
  readonly quarantined: () => Promise<readonly QueuedMutation[]>
}

export type DrainOutcome = {
  readonly sent: number
  readonly conflicted: number
  readonly quarantined: number
  /** True when the drain stopped early because the network is unavailable. */
  readonly stoppedEarly: boolean
}

export interface SyncEngine {
  readonly enqueue: (kind: MutationKind, payload: unknown) => Promise<string>
  readonly drain: () => Promise<DrainOutcome>
  readonly pending: () => Promise<number>
  readonly quarantined: () => Promise<readonly QueuedMutation[]>
}

export interface SyncConfig {
  readonly store: MutationStore
  /** Performs the mutation. Throws `ApiError` or `NetworkError`. */
  readonly send: (mutation: QueuedMutation) => Promise<void>
  readonly newId: () => string
  readonly now: () => number
  /**
   * Attempts before a mutation is quarantined rather than retried forever.
   *
   * Applies to TRANSIENT failures only. Permanent failures quarantine on the first attempt —
   * retrying a 400 is a request that will never succeed, and the athlete's battery pays for it.
   */
  readonly maxAttempts?: number
  readonly onConflict?: (mutation: QueuedMutation, existing: unknown) => void
  readonly onQuarantine?: (mutation: QueuedMutation, reason: string) => void
}

const hasStatus = (error: unknown): error is ApiError =>
  typeof error === 'object' && error !== null && 'status' in error

/**
 * A response the server will give again no matter how many times we ask.
 *
 * 408 (timeout) and 429 (rate limited) are 4xx and are NOT permanent — both explicitly mean "try
 * again". Treating the whole 4xx range as permanent would quarantine a log purely for arriving
 * during a traffic spike.
 */
const isPermanent = (error: unknown): boolean => {
  if (!hasStatus(error)) return false
  const { status } = error
  if (status === 408 || status === 429) return false
  return status >= 400 && status < 500
}

const isConflict = (error: unknown): boolean => hasStatus(error) && error.status === 409

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

  const runDrain = async (): Promise<DrainOutcome> => {
    const queued = [...(await config.store.all())].sort((a, b) => (a.id < b.id ? -1 : 1))
    let sent = 0
    let conflicted = 0
    let quarantined = 0

    for (const mutation of queued) {
      try {
        await config.send(mutation)
        await config.store.remove(mutation.id)
        sent += 1
      } catch (error) {
        if (isConflict(error)) {
          // Already applied. The duplicate is the expected consequence of at-least-once replay,
          // not a problem — but it IS surfaced, because a 409 on a session log means another
          // device got there first and the athlete may have two different records of the same
          // session (ADR-0033).
          await config.store.remove(mutation.id)
          config.onConflict?.(mutation, error)
          conflicted += 1
          continue
        }

        if (isPermanent(error)) {
          const reason = `permanent: ${hasStatus(error) ? String(error.status) : 'unknown'}`
          await config.store.quarantine(mutation, reason)
          config.onQuarantine?.(mutation, reason)
          quarantined += 1
          // CONTINUE, not stop. One malformed mutation must not block every later log.
          continue
        }

        const attempts = mutation.attempts + 1
        if (attempts >= maxAttempts) {
          const reason = `gave up after ${String(attempts)} attempts`
          await config.store.quarantine(mutation, reason)
          config.onQuarantine?.(mutation, reason)
          quarantined += 1
          continue
        }

        await config.store.update({
          ...mutation,
          attempts,
          lastError: error instanceof Error ? error.name : 'unknown',
        })
        // Transient: stop the whole drain. The next mutation would fail identically, and each
        // attempt costs a timeout and battery.
        return { sent, conflicted, quarantined, stoppedEarly: true }
      }
    }

    return { sent, conflicted, quarantined, stoppedEarly: false }
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
    quarantined: () => config.store.quarantined(),
  }
}
