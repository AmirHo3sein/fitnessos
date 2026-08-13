'use client'

import { Button, Card, CardDescription, CardTitle } from '@fitnessos/ui'
import { formatPlainDate, type Locale, type PlainDate } from '@fitnessos/kernel'
import { useState } from 'react'
import type { UnjudgedHypothesisView } from '../../application/index'
import { useUnjudged } from '../hooks/useUnjudged'

export interface UnjudgedLabels {
  readonly title: string
  readonly intro: string
  readonly claim: string
  readonly dueOn: string
  readonly overdue: string
  readonly held: string
  readonly didNotHold: string
  readonly rationaleLabel: string
  readonly rationalePlaceholder: string
  readonly submit: string
  readonly rationaleRequired: string
  /**
   * A read failed, so we cannot say whether anything is owed.
   *
   * Rendered instead of nothing. Nothing is the correct output for "nothing is owed", and it is the
   * worst possible output for "we could not find out" — the two are the same picture, and only one
   * of them means the coach is up to date.
   */
  readonly loadFailed: string
  readonly retry: string
}

export interface UnjudgedHypothesesProps {
  locale: Locale
  labels: UnjudgedLabels
  asOf: PlainDate
}

/**
 * The obligations nobody has discharged.
 *
 * ADR-0003 — "AI proposes, humans decide, the system records why" — is satisfiable on paper by a
 * product that accepts every suggestion and never looks back. This screen is what stops that: it
 * shows every accepted proposal whose claim has come due, and does not let one be dismissed
 * without a reason.
 *
 * Rendering nothing when there is nothing owed is deliberate. A permanent "all caught up" panel
 * is noise, and noise is what teaches someone to stop reading the place a real obligation will
 * appear.
 */
export const UnjudgedHypotheses = ({ locale, labels, asOf }: UnjudgedHypothesesProps) => {
  const { items, render, isRendering, loadFailed, retry } = useUnjudged(asOf)

  /*
    Checked BEFORE the empty case, and the ordering is the fix.

    Rendering nothing when nothing is owed is deliberate and stays. But `?? []` on both queries
    made a failed read produce an empty list, so the two decisions combined to hide the obligation
    rather than show it — the "accepts every suggestion and never looks back" outcome this screen
    exists to prevent, arriving through the screen built to prevent it.
  */
  if (loadFailed) {
    return (
      <section className="space-y-3">
        <h2 className="text-display text-lg">{labels.title}</h2>
        <Card role="alert">
          <CardDescription>{labels.loadFailed}</CardDescription>
          <Button type="button" variant="secondary" size="sm" className="mt-3" onPress={retry}>
            {labels.retry}
          </Button>
        </Card>
      </section>
    )
  }

  if (items.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-display text-lg">{labels.title}</h2>
      <p className="text-muted text-sm">{labels.intro}</p>
      {items.map((item) => (
        <VerdictCard
          key={item.proposalId}
          item={item}
          locale={locale}
          labels={labels}
          isRendering={isRendering}
          onRender={(verdict, rationale) => {
            render({ proposalId: item.proposalId, verdict, rationale })
          }}
        />
      ))}
    </section>
  )
}

const VerdictCard = ({
  item,
  locale,
  labels,
  isRendering,
  onRender,
}: {
  item: UnjudgedHypothesisView
  locale: Locale
  labels: UnjudgedLabels
  isRendering: boolean
  onRender: (verdict: 'held' | 'did-not-hold', rationale: string) => void
}) => {
  const [rationale, setRationale] = useState('')
  const [touched, setTouched] = useState(false)
  const nf = new Intl.NumberFormat(locale)
  const missing = touched && rationale.trim() === ''

  const submit = (verdict: 'held' | 'did-not-hold') => {
    setTouched(true)
    /*
     * Refused locally rather than sent and rejected. `DecisionOutcome` requires a rationale, so
     * the server would refuse it too — but a round trip to be told what this form already knows
     * is a round trip on the slowest connection in the flow.
     */
    if (rationale.trim() === '') return
    onRender(verdict, rationale.trim())
  }

  return (
    <Card>
      <CardTitle>{item.summary}</CardTitle>
      <CardDescription>
        {labels.claim} {item.claim}
      </CardDescription>

      <p className="text-muted mt-2 text-xs">
        {labels.dueOn} {formatPlainDate(item.horizon, locale)}
        {item.overdueByDays > 0 && (
          <span className="text-warning-fg">
            {' · '}
            <span className="nums">{nf.format(item.overdueByDays)}</span> {labels.overdue}
          </span>
        )}
      </p>

      <label className="text-secondary mt-4 block text-sm" htmlFor={`${item.proposalId}-why`}>
        {labels.rationaleLabel}
      </label>
      <textarea
        id={`${item.proposalId}-why`}
        rows={2}
        value={rationale}
        placeholder={labels.rationalePlaceholder}
        onChange={(event) => {
          setRationale(event.target.value)
        }}
        aria-describedby={missing ? `${item.proposalId}-why-error` : undefined}
        className="border-default bg-surface-elevated text-primary focus:border-brand-border mt-1 w-full resize-none rounded-md border px-3 py-2"
      />
      {missing && (
        <p id={`${item.proposalId}-why-error`} className="text-error-fg mt-1 text-xs">
          {labels.rationaleRequired}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          isDisabled={isRendering}
          onPress={() => {
            submit('held')
          }}
        >
          {labels.held}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          isDisabled={isRendering}
          onPress={() => {
            submit('did-not-hold')
          }}
        >
          {labels.didNotHold}
        </Button>
      </div>
    </Card>
  )
}
