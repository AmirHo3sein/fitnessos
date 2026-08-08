import type {
  ExecutionWritePort,
  LogSessionInput,
  SyncIssueSnapshot,
} from '@fitnessos/core/execution'
import type { AuthContext, HttpClient } from '../http/client'
import { ConflictError } from '../http/errors'
import { loggedShapeFrom, logSessionBodyFrom } from '../mappers/performed'
import type { MutationKind, QueuedMutation, SyncEngine } from '../sync/queue'

/**
 * The offline-first write side of Execution.
 *
 * `logSession` enqueues and then OPPORTUNISTICALLY drains. It never awaits the network for its
 * result: the athlete gets an answer as soon as the log is durable on the device, which is the
 * whole point (ADR-0033). The drain is fire-and-forget, and its failure is the queue's business.
 *
 * The body is validated before it is queued, not at replay time. An invalid body discovered on
 * replay would surface days later as a permanent failure that quarantines the session — long
 * after the athlete could do anything about it.
 */
export const createExecutionWriteAdapter = (
  sync: SyncEngine,
  online: () => boolean,
): ExecutionWritePort => ({
  logSession: async (input: LogSessionInput): Promise<boolean> => {
    // Throws here, while the athlete is still looking at the screen that produced it.
    const body = logSessionBodyFrom(input)
    await sync.enqueue('log-session', body)

    if (!online()) return true

    // Not awaited. A slow or dead network must not hold up the confirmation, and the queue
    // already guarantees the log survives.
    void sync.drain()

    // Still reported as queued: the drain has not finished, so claiming it reached the server
    // would be a promise this function cannot keep.
    return true
  },

  pendingLogCount: () => sync.pending(),

  syncIssues: async (): Promise<readonly SyncIssueSnapshot[]> => {
    const issues = await sync.issues()
    return issues.map((issue) => ({
      id: issue.id,
      // `gave-up` and `rejected` collapse here. They are the same fact to an athlete — "this is
      // not saved" — and the difference between them is ours, not theirs.
      reason: issue.reason === 'conflict' ? 'conflict' : 'rejected',
      mine: loggedShapeFrom(issue.payload),
      theirs: issue.reason === 'conflict' ? loggedShapeFrom(issue.existing) : null,
      at: issue.at,
    }))
  },

  dismissSyncIssue: (id: string) => sync.dismissIssue(id),
})

/**
 * How a queued mutation is actually sent. Passed to the sync engine as its `send`.
 *
 * Separate from the adapter because the engine replays mutations long after the code that created
 * them has gone — on a later page, or a later session entirely. It needs a plain function from a
 * stored payload to a request, with no closure over the UI that produced it.
 */
export const createMutationSender =
  (http: HttpClient, auth: AuthContext) =>
  async (mutation: QueuedMutation): Promise<void> => {
    /*
     * A record keyed by MutationKind, not a switch with a default.
     *
     * Same forward guarantee — adding a kind without a handler fails to COMPILE, because the
     * Record is missing a key — with no unreachable branch. A `default: never` case is the usual
     * idiom and is dead code while the union has one member, which the linter correctly objects
     * to; this version keeps the exhaustiveness and loses the dead branch.
     */
    const handlers: Record<MutationKind, (payload: unknown) => Promise<unknown>> = {
      'log-session': async (payload) => {
        /*
         * `allowStatus: [409]` so the conflicting record survives.
         *
         * The default path throws an `ApiError` and discards the body — which for this endpoint
         * is the session the server already holds. Losing it means the athlete can be told their
         * log collided and never shown with what, and a conflict nobody can see is a conflict
         * nobody can resolve (ADR-0033).
         */
        const { status, body } = await http.requestWithStatus('/sessions/performed', {
          method: 'POST',
          body: payload,
          auth,
          allowStatus: [409],
        })

        // Rethrown as a 409 so the queue's existing conflict branch handles it unchanged; the
        // record rides along on the error.
        if (status === 409) throw new ConflictError(body, 'already_logged', 'already logged')
        return body
      },
    }

    await handlers[mutation.kind](mutation.payload)
  }
