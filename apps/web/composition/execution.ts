import type { ExecutionPorts } from '@fitnessos/core/execution'
import {
  createExecutionAdapter,
  createExecutionWriteAdapter,
  createIndexedDbStore,
  createMemoryStore,
  createMutationSender,
  createSyncEngine,
} from '@fitnessos/infra'
import { newPerformedSessionId } from '@fitnessos/kernel'
import type { AuthContext, HttpClient } from './container'

/**
 * Execution ports, including the offline write path (ADR-0033).
 *
 * The sync engine is built HERE, in the composition root, for the same reason everything else is:
 * it needs a store, an HTTP client and a clock, and only this layer may see all three.
 *
 * ## Store selection
 *
 * IndexedDB in the browser; memory on the server. That is not a graceful degradation — an RSC
 * render that enqueued a mutation would be a bug, and the memory store makes it harmless instead
 * of a crash during SSR. It also means the queue is genuinely empty on the server, so a
 * server-rendered "3 pending" badge cannot appear.
 *
 * ## Draining
 *
 * Wired to `online` and `visibilitychange`, not to a timer. A poll would wake the radio on a phone
 * in a pocket; these two events are precisely the moments when a drain can succeed — the network
 * came back, or the athlete opened the app.
 */
export const createExecutionPorts = (http: HttpClient, auth: AuthContext): ExecutionPorts => {
  const isBrowser = typeof indexedDB !== 'undefined'
  const store = isBrowser ? createIndexedDbStore() : createMemoryStore()

  const sync = createSyncEngine({
    store,
    send: createMutationSender(http, auth),
    newId: () => newPerformedSessionId(),
    now: () => Date.now(),
  })

  if (isBrowser) {
    const drain = () => {
      void sync.drain()
    }
    window.addEventListener('online', drain)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') drain()
    })
    // One attempt at construction, for the case where the app opens with a queue already on disk
    // from a previous session.
    drain()
  }

  // `navigator.onLine` is famously unreliable — it reports the interface, not reachability, so a
  // phone connected to a gym wifi with no upstream reads as online. It is used only to skip a
  // pointless drain attempt, never to decide whether the log is safe: that answer is always "yes,
  // it is queued".
  const online = () => (typeof navigator === 'undefined' ? false : navigator.onLine)

  return {
    execution: {
      ...createExecutionAdapter(http, auth),
      ...createExecutionWriteAdapter(sync, online),
    },
  }
}
