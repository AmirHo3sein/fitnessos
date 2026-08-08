import { isErr, localDate, newPerformedSessionId, type Clock } from '@fitnessos/kernel'
import {
  performedSession,
  type PerformedSessionError,
  type PerformedSet,
} from '../domain/PerformedSession'
import type { ExecutionPorts } from './ports/index'

/**
 * Log a performed session.
 *
 * The id is generated HERE, on the client, before anything is sent (D-10). That is what makes the
 * whole offline path work: the log is queued under an id the server has never seen, replayed
 * at-least-once, and a duplicate is recognised by that id and answered with 409 rather than
 * becoming a second record.
 *
 * Generating it server-side would mean a lost response is indistinguishable from a lost request,
 * and the client would have to choose between losing the athlete's set and duplicating it.
 */

export class LogSessionValidationError extends Error {
  override readonly name = 'LogSessionValidationError'
  constructor(readonly problem: PerformedSessionError) {
    super(problem.kind)
  }
}

export interface LogSessionDraft {
  readonly prescribedSessionId: string
  readonly sets: readonly PerformedSet[]
  readonly note: string | null
}

/**
 * Returns as soon as the log is DURABLE, not when it reaches the server.
 *
 * That distinction is the point of the whole feature. An athlete between sets needs the app to
 * accept what they did and get out of the way; waiting for a round trip that may never complete
 * would freeze the UI in exactly the place it must not.
 */
export const logSession = async (
  ports: ExecutionPorts,
  draft: LogSessionDraft,
  clock: Clock,
  zone: string,
): Promise<{ readonly id: string; readonly queued: boolean }> => {
  const id = newPerformedSessionId()
  const performedOn = localDate({ epochMs: clock.now(), zone })

  const session = performedSession({
    id,
    prescribedSessionId: draft.prescribedSessionId as never,
    performedOn,
    sets: draft.sets,
    note: draft.note,
  })
  if (isErr(session)) throw new LogSessionValidationError(session.error)

  // The port ENQUEUES; it does not send. Whether this ever reaches the network is the sync
  // engine's business, and deliberately not this use case's.
  const queued = await ports.execution.logSession({
    id,
    prescribedSessionId: draft.prescribedSessionId,
    performedOn,
    sets: session.value.sets,
    note: session.value.note,
  })

  return { id, queued }
}
