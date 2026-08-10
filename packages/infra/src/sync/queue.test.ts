import { describe, expect, it, vi } from 'vitest'
import { ApiError, ConflictError, NetworkError } from '../http/errors'
import { createMemoryStore } from './memoryStore'
import { createSyncEngine, type SyncConfig } from './queue'

/**
 * The queue's guarantees, each stated as the failure it prevents.
 *
 * These are the tests that matter most in the codebase so far: everything else fails visibly, and
 * this fails by silently losing a set an athlete performed in a gym with no signal — which they
 * discover days later, if ever.
 */

let counter = 0
/** Monotonic ids, so replay order is creation order without depending on a real clock. */
const nextId = () => `018f2c8a-0000-7000-8000-${String(counter++).padStart(12, '0')}`

const engineWith = (
  send: SyncConfig['send'],
  over: Partial<SyncConfig> = {},
) => {
  const store = createMemoryStore()
  const engine = createSyncEngine({
    store,
    send,
    newId: nextId,
    now: () => 1_700_000_000_000,
    ...over,
  })
  return { store, engine }
}

const apiError = (status: number) => new ApiError(status, null, `HTTP ${String(status)}`)
const conflictError = (existing: unknown) => new ConflictError(existing, null, 'already logged')

describe('happy path', () => {
  it('drains queued mutations in id order', async () => {
    const seen: unknown[] = []
    const { engine } = engineWith((m) => {
      seen.push(m.payload)
      return Promise.resolve()
    })

    await engine.enqueue('log-session', { set: 1 })
    await engine.enqueue('log-session', { set: 2 })
    await engine.enqueue('log-session', { set: 3 })

    const outcome = await engine.drain()

    // Sequential and ordered. Draining in parallel would let a later correction land before the
    // log it corrects.
    expect(seen).toEqual([{ set: 1 }, { set: 2 }, { set: 3 }])
    expect(outcome.sent).toBe(3)
    expect(await engine.pending()).toBe(0)
  })

  it('accepts a mutation while offline and keeps it', async () => {
    const { engine } = engineWith(() => Promise.reject(new NetworkError(new Error('offline'))))

    await engine.enqueue('log-session', { set: 1 })
    await engine.drain()

    // Still queued. The athlete's set is not lost because the network was not there.
    expect(await engine.pending()).toBe(1)
  })
})

describe('transient failures stop the drain', () => {
  it('stops on a network error rather than attempting every mutation', async () => {
    // Continuing is pointless — the next will fail identically — and each attempt costs a timeout
    // and battery on the connection least able to afford it.
    const send = vi.fn(() => Promise.reject(new NetworkError(new Error('offline'))))
    const { engine } = engineWith(send)

    await engine.enqueue('log-session', { set: 1 })
    await engine.enqueue('log-session', { set: 2 })
    await engine.enqueue('log-session', { set: 3 })

    const outcome = await engine.drain()

    expect(send).toHaveBeenCalledTimes(1)
    expect(outcome.stoppedEarly).toBe(true)
    expect(await engine.pending()).toBe(3)
  })

  it('stops on a 5xx', async () => {
    const send = vi.fn(() => Promise.reject(apiError(503)))
    const { engine } = engineWith(send)
    await engine.enqueue('log-session', {})
    await engine.enqueue('log-session', {})
    await engine.drain()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('treats 429 as transient, not permanent', async () => {
    // 429 is 4xx and explicitly means "try again". Quarantining a log for arriving during a
    // traffic spike would discard it for a reason that resolves itself.
    const { engine } = engineWith(() => Promise.reject(apiError(429)))
    await engine.enqueue('log-session', {})
    const outcome = await engine.drain()

    expect(outcome.failed).toBe(0)
    expect(await engine.pending()).toBe(1)
  })

  it('treats 408 as transient', async () => {
    const { engine } = engineWith(() => Promise.reject(apiError(408)))
    await engine.enqueue('log-session', {})
    await engine.drain()
    expect(await engine.pending()).toBe(1)
  })

  it('retries a transient failure on the next drain', async () => {
    let attempt = 0
    const { engine } = engineWith(() => {
      attempt += 1
      return attempt === 1 ? Promise.reject(new NetworkError(new Error('x'))) : Promise.resolve()
    })

    await engine.enqueue('log-session', {})
    await engine.drain()
    expect(await engine.pending()).toBe(1)

    await engine.drain()
    expect(await engine.pending()).toBe(0)
  })

  it('quarantines after maxAttempts rather than retrying forever', async () => {
    const { engine } = engineWith(() => Promise.reject(new NetworkError(new Error('x'))), {
      maxAttempts: 3,
    })
    await engine.enqueue('log-session', {})

    await engine.drain()
    await engine.drain()
    await engine.drain()

    expect(await engine.pending()).toBe(0)
    expect((await engine.issues()).length).toBe(1)
  })
})

describe('permanent failures do not block the queue', () => {
  it('skips a poison mutation and CONTINUES', async () => {
    // The failure this exists for. One malformed record that always 400s would otherwise block
    // every later log forever, and the athlete would lose a week of training to it.
    const seen: unknown[] = []
    const { engine } = engineWith((m) => {
      const payload = m.payload as { poison?: boolean }
      if (payload.poison === true) return Promise.reject(apiError(400))
      seen.push(m.payload)
      return Promise.resolve()
    })

    await engine.enqueue('log-session', { set: 1 })
    await engine.enqueue('log-session', { poison: true })
    await engine.enqueue('log-session', { set: 3 })

    const outcome = await engine.drain()

    expect(seen).toEqual([{ set: 1 }, { set: 3 }])
    expect(outcome.sent).toBe(2)
    expect(outcome.failed).toBe(1)
    expect(await engine.pending()).toBe(0)
  })

  it('keeps the athlete’s payload, so nothing is silently destroyed', async () => {
    const { engine } = engineWith(() => Promise.reject(apiError(422)))
    await engine.enqueue('log-session', { set: 7 })
    await engine.drain()

    const issues = await engine.issues()
    expect(issues).toHaveLength(1)
    expect(issues[0]!.payload).toEqual({ set: 7 })
    expect(issues[0]!.reason).toBe('rejected')
  })

  it('quarantines a permanent failure on the FIRST attempt', async () => {
    // Retrying a 400 is a request that will never succeed. The athlete's battery pays for it.
    const send = vi.fn(() => Promise.reject(apiError(400)))
    const { engine } = engineWith(send)
    await engine.enqueue('log-session', {})

    await engine.drain()
    await engine.drain()

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('records the failure DURABLY, not just as a callback', async () => {
    /**
     * The bug this replaced. The engine used to fire `onQuarantine` and nothing subscribed —
     * and a callback is the wrong mechanism regardless, because the drain runs on `online` and
     * `visibilitychange`, which fire when no UI is mounted and sometimes as the app is closing.
     * A log discarded after the product said "saved" is the worst outcome this subsystem has.
     */
    const onIssue = vi.fn()
    const { engine } = engineWith(() => Promise.reject(apiError(400)), { onIssue })
    await engine.enqueue('log-session', { set: 4 })
    await engine.drain()

    // Durable first — this is what survives the app closing.
    const issues = await engine.issues()
    expect(issues).toHaveLength(1)
    expect(issues[0]!.payload).toEqual({ set: 4 })

    // The callback is a convenience on top of it.
    expect(onIssue).toHaveBeenCalledOnce()
  })

  it('an issue stays until it is explicitly dismissed', async () => {
    // Anything else amounts to deciding on the athlete's behalf that they have seen it.
    const { engine } = engineWith(() => Promise.reject(apiError(400)))
    await engine.enqueue('log-session', {})
    await engine.drain()

    await engine.drain()
    expect(await engine.issues()).toHaveLength(1)

    await engine.dismissIssue((await engine.issues())[0]!.id)
    expect(await engine.issues()).toHaveLength(0)
  })
})

describe('409 means already applied', () => {
  it('treats a conflict as success and removes the mutation', async () => {
    // Replay is at-least-once: a mutation whose response was lost gets sent twice. The server
    // rejecting the duplicate is what makes that safe. Without this branch a lost response would
    // poison the queue permanently.
    const { engine } = engineWith(() => Promise.reject(apiError(409)))
    await engine.enqueue('log-session', {})

    const outcome = await engine.drain()

    expect(outcome.conflicted).toBe(1)
    expect(outcome.failed).toBe(0)
    expect(await engine.pending()).toBe(0)
  })

  it('does not stop the drain on a conflict', async () => {
    const seen: unknown[] = []
    const { engine } = engineWith((m) => {
      const payload = m.payload as { dup?: boolean }
      if (payload.dup === true) return Promise.reject(apiError(409))
      seen.push(m.payload)
      return Promise.resolve()
    })

    await engine.enqueue('log-session', { dup: true })
    await engine.enqueue('log-session', { set: 2 })
    await engine.drain()

    expect(seen).toEqual([{ set: 2 }])
  })

  it('records the conflict with BOTH records, not just ours', async () => {
    // A 409 on a session log can mean another device got there first, and the athlete now has
    // two different records of the same session (ADR-0033). Only they can say which is true, so
    // both have to survive until they do.
    const theirs = { id: 'server-1', sets: [{ reps: 5 }] }
    const { engine } = engineWith(() => Promise.reject(conflictError(theirs)))
    await engine.enqueue('log-session', { set: 1 })
    await engine.drain()

    const [issue] = await engine.issues()
    expect(issue?.reason).toBe('conflict')
    expect(issue?.payload).toEqual({ set: 1 })
    expect(issue?.existing).toEqual(theirs)
  })

  it('records the conflict even when the server’s record could not be read', async () => {
    // A plain ApiError carries no body. "Recorded elsewhere" is still worth saying.
    const { engine } = engineWith(() => Promise.reject(apiError(409)))
    await engine.enqueue('log-session', { set: 1 })
    await engine.drain()

    const [issue] = await engine.issues()
    expect(issue?.reason).toBe('conflict')
    expect(issue?.existing).toBeNull()
  })
})

describe('single-flight', () => {
  it('two concurrent drains send each mutation once', async () => {
    // Same discipline as the token refresh. The server's 409 would make a double-send safe rather
    // than corrupting, but it is a wasted round trip on the worst possible connection.
    const send = vi.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 10)),
    )
    const { engine } = engineWith(send)
    await engine.enqueue('log-session', { set: 1 })

    await Promise.all([engine.drain(), engine.drain(), engine.drain()])

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('allows a fresh drain after the previous one settles', async () => {
    const send = vi.fn(() => Promise.resolve())
    const { engine } = engineWith(send)

    await engine.enqueue('log-session', { set: 1 })
    await engine.drain()
    await engine.enqueue('log-session', { set: 2 })
    await engine.drain()

    expect(send).toHaveBeenCalledTimes(2)
  })
})

describe('persistence contract', () => {
  it('stamps a schema version on every record', async () => {
    // This is what makes a queued mutation survive a deploy. Without it, a release changes the
    // payload shape and the athlete's pending log becomes unreadable — silently, because a failed
    // parse looks exactly like an empty queue.
    const { store, engine } = engineWith(() => Promise.resolve())
    await engine.enqueue('log-session', { set: 1 })

    const [record] = await store.all()
    expect(record!.schemaVersion).toBe(1)
    expect(record!.createdAt).toBe(1_700_000_000_000)
  })
})
