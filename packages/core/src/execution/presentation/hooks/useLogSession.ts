'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { systemClock } from '@fitnessos/kernel'
import { logSession, sessionKeys, type LogSessionDraft } from '../../application/index'
import { useExecutionPorts } from '../di'

export interface UseLogSession {
  readonly submit: (draft: LogSessionDraft) => void
  readonly isSubmitting: boolean
  readonly error: Error | null
  /** True once the log is durable. Not "sent" — see ADR-0033. */
  readonly isSaved: boolean
}

/**
 * Records a performed session.
 *
 * `retry: false`, deliberately and unusually. TanStack's retry exists for requests that might
 * succeed on a second attempt — but this mutation does not make a request. It writes to a local
 * queue, and the queue owns every retry decision, with a backoff and a persistence model an
 * in-memory retry cannot match. Leaving the default on would produce two competing retry loops,
 * the outer one dying with the tab.
 */
export const useLogSession = (onLogged: () => void): UseLogSession => {
  const ports = useExecutionPorts()
  const queryClient = useQueryClient()
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const mutation = useMutation({
    /*
     * `networkMode: 'always'` — and this single line is what makes offline logging work at all.
     *
     * TanStack Query's default is `'online'`, which PAUSES a mutation while the browser reports no
     * connection: `mutationFn` is never called, `isPending` stays true, and the UI hangs on a
     * disabled button forever. That default is correct for a mutation that talks to a server, and
     * exactly wrong for this one, which writes to a local queue and never touches the network
     * itself.
     *
     * It cost an afternoon to find, because nothing errors — the whole offline architecture is
     * defeated silently by a library default that appears unrelated to it.
     *
     * ## A correction to what this comment used to say
     *
     * It read: "Set per-mutation rather than globally: sign-in, onboarding and goal declaration DO
     * hit the server, and pausing those offline is the right behaviour." The second half is wrong,
     * and it is now the QueryClient's global default (see `composition/query-client.ts`).
     *
     * Pausing is not a behaviour a person can perceive. `mutationFn` is never called, `isPending`
     * stays true, the promise never settles — so a builder's save button sits disabled with nothing
     * on screen, and a sign-in press does nothing visible at all. Worse than silent: the paused
     * mutation fires when connectivity returns, which can request a verification code minutes after
     * the person gave up and walked away.
     *
     * Demonstrated rather than argued: an e2e that goes offline and presses save waited fifteen
     * seconds for the "your changes were not saved" card this app shows on every other failure, and
     * it never came.
     *
     * So `'always'` is now the default everywhere and this line agrees with it rather than departing
     * from it. It is kept explicit anyway, because here it means something different: not "fail fast
     * so the author can retry" but "never consult the network in the first place — this writes to a
     * durable queue". Same setting, opposite reason.
     */
    networkMode: 'always',
    retry: false,
    mutationFn: (draft: LogSessionDraft) => logSession(ports, draft, systemClock, zone),
    onSuccess: () => {
      // The session is logged, so the upcoming list is stale. Invalidate rather than set: the
      // server decides what is still upcoming, and guessing would leave a completed session on the
      // list or remove one that is repeated.
      void queryClient.invalidateQueries({ queryKey: sessionKeys.all })
      onLogged()
    },
  })

  return {
    submit: mutation.mutate,
    isSubmitting: mutation.isPending,
    error: mutation.error,
    isSaved: mutation.isSuccess,
  }
}
