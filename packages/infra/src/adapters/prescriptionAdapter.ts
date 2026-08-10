import {
  ProgramConflictError,
  type PrescriptionReadPort,
  type PrescriptionWritePort,
  type ProgramSnapshot,
  type ReviseProgramInput,
} from '@fitnessos/ctx-prescription'
import type { AuthContext, HttpClient } from '../http/client'
import { programFrom, reviseProgramBodyFrom } from '../mappers/program'

/**
 * HTTP implementation of `PrescriptionReadPort`.
 *
 * A 204 becomes `null`. The http client returns `undefined` for a no-content response, and
 * `undefined` reaching a React component is how "no programme yet" becomes a blank screen
 * with no explanation — TanStack Query also treats `undefined` as "no data" and warns. Mapping
 * it to an explicit `null` at the boundary makes "the athlete has no programme" a value the UI
 * can render deliberately.
 */
export const createPrescriptionAdapter = (
  http: HttpClient,
  auth: AuthContext,
): PrescriptionReadPort => ({
  currentProgram: async (signal?: AbortSignal): Promise<ProgramSnapshot | null> => {
    const raw = await http.request('/programs/current', {
      auth,
      ...(signal ? { signal } : {}),
    })
    if (raw === undefined || raw === null) return null
    return programFrom(raw)
  },
})

/**
 * The write side.
 *
 * ## Why this is NOT queued offline, unlike session logging
 *
 * A revision is checked against `baseVersionId`. A queued one replayed hours later is very
 * likely to be stale by the time it is sent, and the conflict would surface long after the
 * coach closed the builder — a conflict nobody can resolve is worse than a failed save the
 * author sees immediately. Execution logs are the opposite case: they describe something that
 * already happened, they cannot go stale, and the athlete is in a gym with no signal. Same
 * product, opposite answer, and the difference is whether the write asserts something about the
 * present.
 *
 * ## The three statuses
 *
 *   201  created
 *   200  this exact revision was already stored — a replay after a lost response, and the
 *        reason `id` is client-generated (ADR-0010). Indistinguishable from success here, which
 *        is the point.
 *   409  the base is no longer current. `allowStatus` keeps the body, because the body is the
 *        programme as it now stands and throwing it away would leave the author with an error
 *        message and no way to see what they collided with.
 */
export const createPrescriptionWriteAdapter = (
  http: HttpClient,
  auth: AuthContext,
): PrescriptionWritePort => ({
  revise: async (input: ReviseProgramInput, signal?: AbortSignal): Promise<ProgramSnapshot> => {
    const body = reviseProgramBodyFrom(input)
    const { status, body: raw } = await http.requestWithStatus(
      `/programs/${input.programId}/versions`,
      { method: 'POST', body, auth, allowStatus: [409], ...(signal ? { signal } : {}) },
    )

    // Mapped before the status is inspected: a 409 body is a Program too, and a malformed one is
    // a contract violation whichever status carried it.
    const program = programFrom(raw)
    if (status === 409) throw new ProgramConflictError(program)
    return program
  },
})
