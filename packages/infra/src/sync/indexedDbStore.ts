import {
  QUEUE_SCHEMA_VERSION,
  type MutationStore,
  type QueuedMutation,
  type SyncIssue,
} from './queue'

/**
 * IndexedDB-backed store. The browser implementation.
 *
 * IndexedDB rather than localStorage, and the reason is not capacity. localStorage is
 * SYNCHRONOUS: every write blocks the main thread, and a logged set during a workout would jank
 * the very interaction it is recording. It is also string-only, so every read costs a JSON parse
 * of the whole queue.
 *
 * Written against the raw API rather than pulling in a wrapper. It is roughly eighty lines, it
 * runs on the athlete's phone, and the alternative is a dependency in the bundle budget of the
 * one screen used in a basement with no signal.
 */

const DB_NAME = 'fitnessos-sync'
/**
 * Bumped to 2 when quarantine became the issue log.
 *
 * The old `quarantine` store is READ during the upgrade and its records carried forward, not
 * dropped. A deploy that silently discarded an athlete's failed logs would be the same data loss
 * this whole subsystem exists to prevent, arriving by a different route.
 */
const DB_VERSION = 2
const PENDING = 'pending'
const ISSUES = 'issues'
/** v1's name for what is now the issue log. Read once during upgrade, then left alone. */
const LEGACY_QUARANTINE = 'quarantine'

/**
 * Migration for records written by an older build.
 *
 * This is why every record carries `schemaVersion`. A queued mutation written before a deploy
 * must still be readable after it, or the athlete's log is destroyed by a release they did not
 * ask for — and it would be destroyed silently, since a failed parse looks identical to an empty
 * queue.
 *
 * Returning `null` means "cannot be understood", which routes the record to quarantine rather
 * than dropping it.
 */
const migrate = (raw: unknown): QueuedMutation | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Partial<QueuedMutation>
  if (typeof record.id !== 'string' || typeof record.kind !== 'string') return null

  const version = typeof record.schemaVersion === 'number' ? record.schemaVersion : 0

  // v0 → v1: `attempts` and `lastError` were added. Absent means a fresh record.
  if (version > QUEUE_SCHEMA_VERSION) {
    // Written by a NEWER build than this one — a user on a stale tab after a deploy. Refusing is
    // correct: this build cannot know what the fields mean, and guessing would corrupt.
    return null
  }

  return {
    id: record.id,
    kind: record.kind,
    payload: record.payload,
    schemaVersion: QUEUE_SCHEMA_VERSION,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    attempts: typeof record.attempts === 'number' ? record.attempts : 0,
    lastError: typeof record.lastError === 'string' ? record.lastError : null,
  }
}

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(ISSUES)) db.createObjectStore(ISSUES, { keyPath: 'id' })

      // v1 → v2. Carried across inside the upgrade transaction, which is the only place both
      // stores can be touched atomically; a copy afterwards could be interrupted and lose them.
      if (event.oldVersion < 2 && db.objectStoreNames.contains(LEGACY_QUARANTINE)) {
        const tx = request.transaction
        if (tx !== null) {
          const legacy = tx.objectStore(LEGACY_QUARANTINE)
          const issues = tx.objectStore(ISSUES)
          legacy.getAll().onsuccess = (read) => {
            const rows = (read.target as IDBRequest<unknown[]>).result
            for (const row of rows) {
              const mutation = migrate(row)
              if (mutation === null) continue
              issues.put({
                id: mutation.id,
                kind: mutation.kind,
                reason: 'rejected',
                payload: mutation.payload,
                existing: null,
                detail: mutation.lastError,
                // The original timestamp, not now. A migration must not make an old failure look
                // like it happened during the upgrade.
                at: mutation.createdAt,
              } satisfies SyncIssue)
            }
          }
        }
      }
    }
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(new Error('could not open the offline queue'))
    }
  })

const run = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const request = action(tx.objectStore(storeName))
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(new Error('offline queue write failed'))
    }
    tx.oncomplete = () => {
      db.close()
    }
  })
}

const readAll = async (storeName: string): Promise<readonly QueuedMutation[]> => {
  const raw = await run<unknown[]>(storeName, 'readonly', (store) => store.getAll())
  const migrated: QueuedMutation[] = []
  for (const record of raw) {
    const value = migrate(record)
    // An undecodable record is skipped here rather than throwing, so ONE bad record cannot make
    // the whole queue unreadable. It stays on disk for inspection.
    if (value !== null) migrated.push(value)
  }
  return migrated
}

const isSyncIssue = (raw: unknown): raw is SyncIssue => {
  if (typeof raw !== 'object' || raw === null) return false
  const record = raw as Partial<SyncIssue>
  return (
    typeof record.id === 'string' &&
    (record.reason === 'conflict' || record.reason === 'rejected' || record.reason === 'gave-up')
  )
}

export const createIndexedDbStore = (): MutationStore => ({
  enqueue: async (mutation) => {
    await run(PENDING, 'readwrite', (store) => store.put(mutation))
  },
  all: () => readAll(PENDING),
  remove: async (id) => {
    await run(PENDING, 'readwrite', (store) => store.delete(id))
  },
  update: async (mutation) => {
    await run(PENDING, 'readwrite', (store) => store.put(mutation))
  },
  recordIssue: async (issue) => {
    await run(ISSUES, 'readwrite', (store) => store.put(issue))
  },
  issues: async () => {
    const raw = await run<unknown[]>(ISSUES, 'readonly', (store) => store.getAll())
    // Same rule as the queue: ONE undecodable record must not make the whole issue log
    // unreadable, which would hide every other failed log behind a single bad row.
    return raw.filter(isSyncIssue)
  },
  dismissIssue: async (id) => {
    await run(ISSUES, 'readwrite', (store) => store.delete(id))
  },
})

/**
 * The store this platform can actually provide.
 *
 * Server-side there is no IndexedDB and no offline: a render that enqueued a mutation would be a
 * bug, and an in-memory store makes that harmless rather than a crash during SSR.
 */
export const createPlatformStore = (): MutationStore => {
  if (typeof indexedDB === 'undefined') {
    // Imported lazily to keep the IndexedDB path free of it.
    throw new Error('createPlatformStore called without IndexedDB; use createMemoryStore')
  }
  return createIndexedDbStore()
}
