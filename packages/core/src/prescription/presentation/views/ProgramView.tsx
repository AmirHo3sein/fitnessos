'use client'

import { Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import type { Locale } from '@fitnessos/kernel'
import { useCurrentProgram } from '../hooks/useCurrentProgram'

export interface ProgramLabels {
  readonly title: string
  readonly version: string
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
 * Read-only.
 *
 * The Program Builder is not here, and its absence is a decision rather than an omission: it
 * needs `packages/editor-engine` (handbook D-01–D-04) for inverse-action history, a spatial
 * index and branded coordinate spaces. An editor that can open a coach's programme and cannot
 * reliably undo is a way to lose their work, so half of it would be worse than none.
 *
 * What this does prove out is the read path an editor will sit on: the aggregates, the
 * contract, the mapper, and the block ordering invariant.
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
        <p className="text-faint mt-2 text-sm">{labels.noProgramHint}</p>
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

      {/*
        An ordered list, because the blocks ARE an order — an athlete follows them in
        sequence. A `<div>` stack would render identically and tell a screen reader nothing
        about position or count.
      */}
      <ol className="mt-5 space-y-3">
        {version.blocks.map((block) => (
          <li key={block.id} className="border-line bg-elevated rounded-md border p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-fg font-medium">{block.name}</span>
              <span className="text-muted shrink-0 text-xs">
                {labels.progression[block.progression.kind] ?? block.progression.kind}
              </span>
            </div>
            {block.progression.ratePercent !== null && (
              <p className="text-faint mt-1 text-xs">
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
