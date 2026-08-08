'use client'

import { Card, CardDescription, CardTitle, RefChip, Skeleton } from '@fitnessos/ui'
import { refKey, type DocumentRef } from '@fitnessos/editor-engine'
import type { Locale } from '@fitnessos/kernel'
import type { ProgramVersionSnapshot } from '../../application/index'
import { useCurrentProgram } from '../hooks/useCurrentProgram'
import { useResolvedRefs } from '../hooks/useResolvedRefs'

export interface RefLabels {
  readonly loading: string
  readonly deleted: string
  readonly forbidden: string
  /**
   * Shown when the document has no words of its own about the goal.
   *
   * `ServesGoal` carries a `goalId` and an optional `rationale` — no label. So when the goal is
   * gone AND no rationale was written, there is genuinely nothing left to render, and this is
   * what says so. It is the D-08 `fallbackLabel` requirement meeting a contract that predates it.
   */
  readonly unnamedGoal: string
}

export interface ProgramLabels {
  readonly title: string
  readonly version: string
  readonly servesGoal: string
  readonly refs: RefLabels
  readonly noProgram: string
  readonly noProgramHint: string
  readonly progression: Readonly<Record<string, string>>
  readonly ratePerCycle: string
  readonly authoredByHuman: string
  readonly authoredByAssistant: string
  readonly loading: string
  readonly failed: string
}

export interface ProgramViewProps {
  locale: Locale
  labels: ProgramLabels
}

/**
 * Read-only. Editing lives in `ProgramBuilder`, behind the switch in `ProgramWorkspace`.
 *
 * Kept as a separate component rather than folded into the builder, because a programme is read
 * far more often than it is written: an athlete never edits, and this is the whole of what they
 * see. Rendering the editor's markup in a disabled state for them would ship the editor's weight
 * to every reader for nothing.
 */
export const ProgramView = ({ locale, labels }: ProgramViewProps) => {
  const { data, isPending, isError } = useCurrentProgram()

  if (isPending) {
    return (
      <Card>
        <Skeleton className="h-6 w-48" label={labels.loading} />
        <Skeleton className="mt-3 h-24 w-full" label={labels.loading} />
      </Card>
    )
  }

  if (isError) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.failed}</CardDescription>
      </Card>
    )
  }

  // `null` is a real answer, not a loading state. A newly-onboarded athlete has no programme
  // and deserves an explanation rather than an empty card.
  if (data === null) {
    return (
      <Card>
        <CardTitle>{labels.title}</CardTitle>
        <CardDescription>{labels.noProgram}</CardDescription>
        <p className="text-muted mt-2 text-sm">{labels.noProgramHint}</p>
      </Card>
    )
  }

  const nf = new Intl.NumberFormat(locale)
  const { currentVersion: version } = data

  return (
    <Card>
      <CardTitle>{data.title}</CardTitle>
      <CardDescription>
        {labels.version} <span className="nums">{nf.format(version.versionNumber)}</span>
        {' · '}
        {version.authoredBy.proposedBy === 'assistant'
          ? labels.authoredByAssistant
          : labels.authoredByHuman}
      </CardDescription>

      <ServesGoal version={version} labels={labels} />

      {/*
        An ordered list, because the blocks ARE an order — an athlete follows them in
        sequence. A `<div>` stack would render identically and tell a screen reader nothing
        about position or count.
      */}
      <ol className="mt-5 space-y-3">
        {version.blocks.map((block) => (
          <li key={block.id} className="border-default bg-surface-elevated rounded-md border p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-primary font-medium">{block.name}</span>
              <span className="text-muted shrink-0 text-xs">
                {labels.progression[block.progression.kind] ?? block.progression.kind}
              </span>
            </div>
            {block.progression.ratePercent !== null && (
              <p className="text-muted mt-1 text-xs">
                <span className="nums">{nf.format(block.progression.ratePercent)}%</span>{' '}
                {labels.ratePerCycle}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}

/**
 * The goal this programme serves — a cross-document reference (D-08).
 *
 * It points at Development, which this context may not import. What makes that possible is the
 * `ReferenceResolver` port behind `useResolvedRefs`: this component asks for a reference to be
 * resolved and never learns what a goal is.
 *
 * The reference is VERSION-level rather than a node property, so it does not come from
 * `refsIn(document)`. `useResolvedRefs` takes an array precisely so it does not care where the
 * references were found — a builder whose refs live on nodes passes `refsIn(doc)` instead.
 */
const ServesGoal = ({
  version,
  labels,
}: {
  version: ProgramVersionSnapshot
  labels: ProgramLabels
}) => {
  const serves = version.servesGoal
  const ref: DocumentRef | null =
    serves === null
      ? null
      : {
          kind: 'goal',
          id: serves.goalId,
          // The rationale, because it is the document's own words about WHY it points there —
          // the most meaningful thing still readable once the goal itself is gone.
          fallbackLabel: serves.rationale ?? labels.refs.unnamedGoal,
        }

  // Called unconditionally: hooks cannot be skipped, and an empty array is a real answer the hook
  // handles rather than a special case the caller has to avoid.
  const resolved = useResolvedRefs(ref === null ? [] : [ref])

  if (ref === null) return null

  return (
    <p className="mt-3 flex items-center gap-2 text-sm">
      <span className="text-muted">{labels.servesGoal}</span>
      <RefChip
        resolution={resolved?.get(refKey(ref)) ?? { state: 'loading' }}
        fallbackLabel={ref.fallbackLabel}
        labels={labels.refs}
      />
    </p>
  )
}
