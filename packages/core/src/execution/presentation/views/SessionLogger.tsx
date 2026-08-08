'use client'

import { Button, Card, CardTitle } from '@fitnessos/ui'
import { newEntityId, normalizeDigits, type Locale } from '@fitnessos/kernel'
import { useState } from 'react'
import { LogSessionValidationError } from '../../application/index'
import type { PrescribedSessionSnapshot } from '../../application/index'
import { useLogSession } from '../hooks/useLogSession'

export interface LoggerLabels {
  readonly heading: string
  readonly reps: string
  readonly load: string
  readonly bodyweight: string
  readonly addSet: string
  readonly save: string
  readonly noteLabel: string
  readonly notePlaceholder: string
  readonly errors: Readonly<Record<string, string>>
}

export interface SessionLoggerProps {
  session: PrescribedSessionSnapshot
  locale: Locale
  labels: LoggerLabels
  onLogged: () => void
}

interface Draft {
  readonly id: string
  readonly itemId: string
  readonly setNumber: number
  readonly reps: string
  readonly load: string
}

const messageFor = (error: Error | null, labels: LoggerLabels): string | null => {
  if (error === null) return null
  if (error instanceof LogSessionValidationError) {
    return labels.errors[error.problem.kind] ?? labels.errors['generic'] ?? null
  }
  return labels.errors['generic'] ?? null
}

/**
 * Logs what the athlete actually did.
 *
 * Pre-filled from the prescription, because the common case by a wide margin is "I did what it
 * said". An empty form would make the normal path the most work, and a tired athlete between sets
 * abandons forms.
 *
 * Every field is editable, because the second most common case is doing something slightly
 * different — and a logger that only accepts the prescription records fiction.
 */
export const SessionLogger = ({ session, locale, labels, onLogged }: SessionLoggerProps) => {
  const log = useLogSession(onLogged)

  const [drafts, setDrafts] = useState<readonly Draft[]>(() =>
    session.items.flatMap((item) =>
      Array.from({ length: item.sets }, (_, index) => ({
        // A real UUIDv7, not `${itemId}-${n}`. The contract requires `format: uuid` on a set id,
        // and the composed form was rejected by outbound validation — which is precisely the bug
        // that check exists to catch, discovered at log time rather than on replay days later.
        id: newEntityId(),
        itemId: item.id,
        setNumber: index + 1,
        reps: String(item.reps),
        load: item.loadKg === null ? '' : String(item.loadKg),
      })),
    ),
  )
  const [note, setNote] = useState('')

  const error = messageFor(log.error, labels)
  const nf = new Intl.NumberFormat(locale)

  const update = (id: string, patch: Partial<Draft>) => {
    setDrafts((current) => current.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        log.submit({
          prescribedSessionId: session.id,
          note: note.trim() === '' ? null : note,
          sets: drafts
            // A blank rep count means the set was not done. Dropping it is how an athlete records
            // stopping early, which is the most informative log in the product — so it must not be
            // an error, and must not be sent as a zero.
            .filter((d) => normalizeDigits(d.reps).trim() !== '')
            .map((d) => ({
              id: d.id,
              prescribedItemId: d.itemId,
              setNumber: d.setNumber,
              reps: Number(normalizeDigits(d.reps)),
              loadKg:
                normalizeDigits(d.load).trim() === '' ? null : Number(normalizeDigits(d.load)),
              rpe: null,
            })),
        })
      }}
    >
      {session.items.map((item) => (
        <Card key={item.id}>
          <CardTitle>{item.movementName}</CardTitle>
          <ol className="mt-3 space-y-2">
            {drafts
              .filter((d) => d.itemId === item.id)
              .map((draft) => (
                <li key={draft.id} className="flex items-center gap-2">
                  <span className="text-muted nums w-6 shrink-0 text-xs">
                    {nf.format(draft.setNumber)}
                  </span>
                  <label className="sr-only" htmlFor={`${draft.id}-reps`}>
                    {labels.reps}
                  </label>
                  <input
                    id={`${draft.id}-reps`}
                    inputMode="numeric"
                    dir="ltr"
                    value={draft.reps}
                    onChange={(e) => {
                      update(draft.id, { reps: e.target.value })
                    }}
                    placeholder={labels.reps}
                    className="border-default bg-surface-elevated text-primary focus:border-brand-border nums h-11 w-full rounded-md border px-3"
                  />
                  <label className="sr-only" htmlFor={`${draft.id}-load`}>
                    {labels.load}
                  </label>
                  <input
                    id={`${draft.id}-load`}
                    inputMode="decimal"
                    dir="ltr"
                    value={draft.load}
                    onChange={(e) => {
                      update(draft.id, { load: e.target.value })
                    }}
                    placeholder={labels.bodyweight}
                    className="border-default bg-surface-elevated text-primary focus:border-brand-border nums h-11 w-full rounded-md border px-3"
                  />
                </li>
              ))}
          </ol>
        </Card>
      ))}

      <div>
        <label htmlFor="session-note" className="text-muted mb-1.5 block text-sm">
          {labels.noteLabel}
        </label>
        <textarea
          id="session-note"
          rows={2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
          }}
          placeholder={labels.notePlaceholder}
          className="border-default bg-surface-elevated text-primary focus:border-brand-border w-full resize-none rounded-md border px-3 py-2"
        />
      </div>

      {error !== null && (
        <p role="alert" id="logger-error" className="text-error-fg text-sm">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" isDisabled={log.isSubmitting}>
        {labels.save}
      </Button>

      {/*
        The confirmation is NOT rendered here.
        `onLogged` closes this logger, so a success message inside it would be unmounted in the
        same tick it became true — it rendered for zero frames and the e2e caught it. Transient
        feedback about a completed action belongs to whatever SURVIVES the action, which is the
        screen that owns the open/closed state.
      */}
    </form>
  )
}
