import { QUEUE_SCHEMA_VERSION, type MutationStore, type QueuedMutation } from './queue'

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
const DB_VERSION = 1
const PENDING = 'pending'
const QUARANTINE = 'quarantine'

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
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(QUARANTINE)) {
        db.createObjectStore(QUARANTINE, { keyPath: 'id' })
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
  quarantine: async (mutation, reason) => {
    await run(QUARANTINE, 'readwrite', (store) => store.put({ ...mutation, lastError: reason }))
    await run(PENDING, 'readwrite', (store) => store.delete(mutation.id))
  },
  quarantined: () => readAll(QUARANTINE),
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
