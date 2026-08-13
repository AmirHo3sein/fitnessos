'use client'

import { Button, Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import type { Locale } from '@fitnessos/kernel'
import { Suspense, lazy, useRef, useState } from 'react'
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
  /**
   * Close the panel and decide later.
   *
   * A fifth string, added when "keep" stopped meaning "dismiss". It used to: the button cleared the
   * error and left the draft open, which read as a resolution and was not one — the base was still
   * the version the server had refused, so the next Save produced the same conflict. Now "keep"
   * stores the draft, and closing without deciding needs a name of its own. The same five the six
   * artefact workspaces use, because a coach meets this situation in seven places and it should
   * read as one situation.
   */
  readonly conflictDismiss: string
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
  const { save, isSaving, error, conflict, keepMine, takeTheirs, reset } = useReviseProgram(version)

  /*
    The document the last save attempt carried — what "keep mine" sends again.

    The workspace holds no draft of its own: it lives in the builder's editor store and surfaces
    here only as the argument to `onSave`. A ref rather than state, because nothing renders
    differently for it and re-rendering the canvas on every save would be work for no picture.
  */
  const attempted = useRef<ProgramVersionSnapshot | null>(null)

  const attempt = (next: ProgramVersionSnapshot) => {
    attempted.current = next
    return save(next)
  }

  return (
    <div className="space-y-4">
      {conflict !== null && (
        <Card role="alert">
          <CardTitle>{labels.conflictTitle}</CardTitle>
          <CardDescription>{labels.conflictBody}</CardDescription>
          {/*
            Three options, and nothing here is destructive by default (ADR-0033). The local blocks
            stay in the editor until the coach says otherwise, and the other author's version is
            never replaced without having been quoted back to us first.

            There used to be two, and neither resolved anything: "keep" cleared the error and left
            the base the server had already refused, so pressing Save produced the identical 409 for
            ever; "discard" left the editing session, and versions are immutable (ADR-0008), so the
            work it dropped was gone.
          */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              isDisabled={isSaving}
              onPress={() => {
                const mine = attempted.current
                if (mine === null) return
                void keepMine(mine)
              }}
            >
              {labels.conflictKeep}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onPress={() => {
                // No `onDone()`: the builder re-keys on the adopted version and shows what the coach
                // chose. Closing the editor instead would leave them looking at a read view with no
                // sign that their own blocks are gone.
                takeTheirs()
              }}
            >
              {labels.conflictDiscard}
            </Button>
            <Button type="button" variant="ghost" size="sm" onPress={reset}>
              {labels.conflictDismiss}
            </Button>
          </div>
        </Card>
      )}

      {error !== null && (
        <Card role="alert">
          <CardDescription>{labels.saveFailed}</CardDescription>
        </Card>
      )}

      <Suspense fallback={<Skeleton className="h-64 w-full" label={labels.loading} />}>
        <ProgramBuilder
          version={version}
          locale={locale}
          labels={labels.builder}
          onSave={attempt}
          isSaving={isSaving}
        />
      </Suspense>

      <Button type="button" variant="ghost" onPress={onDone}>
        {labels.cancel}
      </Button>
    </div>
  )
}
