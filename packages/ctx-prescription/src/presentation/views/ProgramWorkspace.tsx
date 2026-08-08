'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import type { Locale } from '@fitnessos/kernel'
import { Suspense, lazy, useState } from 'react'
import type { ProgramVersionSnapshot } from '../../application/index'
import { useCurrentProgram } from '../hooks/useCurrentProgram'
import { useReviseProgram } from '../hooks/useReviseProgram'
import type { BuilderLabels } from './ProgramBuilder'
import { ProgramView, type ProgramLabels } from './ProgramView'

/**
 * The builder is loaded ONLY when someone edits.
 *
 * It pulls in the editor engine, its React bindings and the history machinery — weight that an
 * athlete, who never edits, would otherwise pay for on every visit to their programme. Splitting
 * it here rather than at the route is what makes the read path cheap while keeping the two views
 * in one place.
 */
const ProgramBuilder = lazy(async () => ({
  default: (await import('./ProgramBuilder')).ProgramBuilder,
}))

export interface WorkspaceLabels extends ProgramLabels {
  readonly edit: string
  readonly cancel: string
  readonly saveFailed: string
  readonly conflictTitle: string
  readonly conflictBody: string
  readonly conflictDiscard: string
  readonly conflictKeep: string
  readonly builder: BuilderLabels
}

export interface ProgramWorkspaceProps {
  locale: Locale
  labels: WorkspaceLabels
}

/**
 * Read or edit the same programme.
 *
 * Two modes rather than an always-editable view. A programme is read far more often than it is
 * written, and an editor that is always open makes an accidental keystroke a revision — which,
 * because versions are immutable (ADR-0008), cannot be tidied away afterwards.
 */
export const ProgramWorkspace = ({ locale, labels }: ProgramWorkspaceProps) => {
  const { data } = useCurrentProgram()
  const [editing, setEditing] = useState(false)

  if (data === null || data === undefined || !editing) {
    return (
      <div className="space-y-4">
        <ProgramView locale={locale} labels={labels} />
        {data !== null && data !== undefined && (
          <Button
            type="button"
            variant="secondary"
            onPress={() => {
              setEditing(true)
            }}
          >
            {labels.edit}
          </Button>
        )}
      </div>
    )
  }

  return (
    <EditingSession
      version={data.currentVersion}
      locale={locale}
      labels={labels}
      onDone={() => {
        setEditing(false)
      }}
    />
  )
}

/**
 * Split out so the mutation hook is BOUND to the version being edited.
 *
 * `useReviseProgram(base)` closes over what the revision is based on. If it were called in the
 * parent it would keep re-binding to whatever the query currently holds, and a save that started
 * against version 3 could be sent claiming version 4 as its base — silently overwriting the
 * revision it was supposed to conflict with. Mounting a component per session makes the base a
 * fact fixed at the moment editing began.
 */
const EditingSession = ({
  version,
  locale,
  labels,
  onDone,
}: {
  version: ProgramVersionSnapshot
  locale: Locale
  labels: WorkspaceLabels
  onDone: () => void
}) => {
  const { save, isSaving, error, conflict, reset } = useReviseProgram(version)

  return (
    <div className="space-y-4">
      {conflict !== null && (
        <Card>
          <CardTitle>{labels.conflictTitle}</CardTitle>
          <CardDescription>{labels.conflictBody}</CardDescription>
          {/*
            Both options preserve something, and neither is destructive by default (ADR-0033).
            "Keep editing" leaves the local document exactly as it is — the coach's work is still
            in the editor, and dismissing the banner does not discard it. "Discard" is the
            explicit choice to take the other author's version instead.
          */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onPress={reset}>
              {labels.conflictKeep}
            </Button>
            <Button type="button" variant="ghost" size="sm" onPress={onDone}>
              {labels.conflictDiscard}
            </Button>
          </div>
        </Card>
      )}

      {error !== null && (
        <Card>
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}

      <Suspense fallback={<Skeleton className="h-64 w-full" label={labels.loading} />}>
        <ProgramBuilder
          version={version}
          locale={locale}
          labels={labels.builder}
          onSave={save}
          isSaving={isSaving}
        />
      </Suspense>

      <Button type="button" variant="ghost" onPress={onDone}>
        {labels.cancel}
      </Button>
    </div>
  )
}
