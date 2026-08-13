'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  sessionKeys,
  syncIssuesQuery,
  type SyncIssueSnapshot,
} from '../../application/index'
import { useExecutionPorts } from '../di'

export interface UseSyncIssues {
  readonly issues: readonly SyncIssueSnapshot[]
  readonly dismiss: (id: string) => void
  /**
   * The issue log could not be READ.
   *
   * `data ?? []` made that indistinguishable from having no unsent logs, and the view renders
   * nothing for an empty list — so a failed read recreated, exactly, the silence this banner exists
   * to break: the product said "saved" and then quietly did not say otherwise. The store is on the
   * device, so this is rare; it is also the case where the athlete has least reason to look.
   */
  readonly loadFailed: boolean
  /** Re-read the local store. */
  readonly retry: () => void
}

/**
 * Logs that never reached the server, and are waiting to be acknowledged (ADR-0033).
 *
 * A query even though the source is local: the replay that produces these runs on `online` and
 * `visibilitychange`, so an issue can appear while this component is already mounted and nothing
 * re-renders it. Going through the cache means the sync engine's `onIssue` can invalidate one key
 * and the banner updates, without the engine knowing a React tree exists.
 *
 * Dismissal invalidates rather than optimistically removing. There is no round trip to hide — the
 * store is on the device — and an optimistic update here would be complexity bought for nothing.
 */
export const useSyncIssues = (): UseSyncIssues => {
  const ports = useExecutionPorts()
  const queryClient = useQueryClient()

  const query = useQuery(syncIssuesQuery(ports))

  const dismissal = useMutation({
    mutationFn: (id: string) => ports.execution.dismissSyncIssue(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionKeys.syncIssues() }),
  })

  return {
    issues: query.data ?? [],
    dismiss: dismissal.mutate,
    loadFailed: query.isError,
    retry: () => {
      void query.refetch()
    },
  }
}
