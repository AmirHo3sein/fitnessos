import type { MutationStore, QueuedMutation, SyncIssue } from './queue'

/**
 * In-memory store.
 *
 * The reference implementation and the one every test uses. It exists so the queue's logic can be
 * tested without a browser, a fake-IndexedDB shim, or async storage timing — the failure modes
 * that matter (poison messages, ordering, transient vs permanent) are queue logic, not storage
 * logic, and testing them through IndexedDB would test the shim.
 *
 * Also the correct store on the SERVER, where there is no persistence and no offline: an RSC
 * render that enqueued a mutation would be a bug, and this makes it a no-op rather than a crash.
 */
export const createMemoryStore = (): MutationStore => {
  const queue = new Map<string, QueuedMutation>()
  const issues = new Map<string, SyncIssue>()

  return {
    enqueue: (mutation) => {
      queue.set(mutation.id, mutation)
      return Promise.resolve()
    },
    all: () => Promise.resolve([...queue.values()]),
    remove: (id) => {
      queue.delete(id)
      return Promise.resolve()
    },
    update: (mutation) => {
      queue.set(mutation.id, mutation)
      return Promise.resolve()
    },
    recordIssue: (issue) => {
      issues.set(issue.id, issue)
      return Promise.resolve()
    },
    issues: () => Promise.resolve([...issues.values()]),
    dismissIssue: (id) => {
      issues.delete(id)
      return Promise.resolve()
    },
  }
}
