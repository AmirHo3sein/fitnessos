import { describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from '../http/errors'
import { createMemoryStore } from './memoryStore'
import { createSyncEngine, type QueuedMutation, type SyncConfig } from './queue'

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

    expect(outcome.quarantined).toBe(0)
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
    expect((await engine.quarantined()).length).toBe(1)
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
    expect(outcome.quarantined).toBe(1)
    expect(await engine.pending()).toBe(0)
  })

  it('quarantines rather than deleting, so nothing is silently destroyed', async () => {
    const { engine } = engineWith(() => Promise.reject(apiError(422)))
    await engine.enqueue('log-session', { set: 7 })
    await engine.drain()

    const dead = await engine.quarantined()
    expect(dead).toHaveLength(1)
    expect(dead[0]!.payload).toEqual({ set: 7 })
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

  it('reports the quarantine so it can be surfaced', async () => {
    const onQuarantine = vi.fn()
    const { engine } = engineWith(() => Promise.reject(apiError(400)), { onQuarantine })
    await engine.enqueue('log-session', {})
    await engine.drain()

    expect(onQuarantine).toHaveBeenCalledOnce()
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
    expect(outcome.quarantined).toBe(0)
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

  it('surfaces the conflict rather than swallowing it', async () => {
    // A 409 on a session log means another device got there first, and the athlete may now have
    // two different records of the same session (ADR-0033). Silently discarding ours would lose a
    // set they actually performed.
    const onConflict = vi.fn()
    const { engine } = engineWith(() => Promise.reject(apiError(409)), { onConflict })
    await engine.enqueue('log-session', { set: 1 })
    await engine.drain()

    expect(onConflict).toHaveBeenCalledOnce()
    const [mutation] = onConflict.mock.calls[0] as [QueuedMutation]
    expect(mutation.payload).toEqual({ set: 1 })
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
