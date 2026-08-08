'use client'

import { Button } from '@fitnessos/ui'
import {
  addDays,
  countGraphemes,
  localDate,
  normalizeDigits,
  systemClock,
  type AthleteId,
} from '@fitnessos/kernel'
import { useState } from 'react'
import { DeclareGoalValidationError, type GoalSnapshot } from '../../application/index'
import { DEFAULT_CADENCE_DAYS } from '../../domain/EvaluationPolicy'
import { MAX_INTENT_LENGTH } from '../../domain/GoalIntent'
import { useDeclareGoal } from '../hooks/useDeclareGoal'

export interface GoalLabels {
  readonly intentLabel: string
  readonly intentPlaceholder: string
  readonly intentHint: string
  readonly horizonLabel: string
  readonly horizonHint: string
  readonly horizonOpenEnded: string
  readonly submit: string
  readonly skip: string
  readonly errors: Readonly<Record<string, string>>
}

export interface GoalDeclarationFormProps {
  athleteId: AthleteId
  labels: GoalLabels
  onDeclared: (goal: GoalSnapshot) => void
  onSkip: () => void
}

const messageFor = (error: Error | null, labels: GoalLabels): string | null => {
  if (error === null) return null
  if (error instanceof DeclareGoalValidationError) {
    return labels.errors[error.problem.reason.kind] ?? labels.errors['generic'] ?? null
  }
  return labels.errors['generic'] ?? null
}

/** Horizon offered as a number of weeks, because that is how people think about it. */
const WEEK_OPTIONS = [8, 12, 24, 52] as const

export const GoalDeclarationForm = ({
  athleteId,
  labels,
  onDeclared,
  onSkip,
}: GoalDeclarationFormProps) => {
  const goal = useDeclareGoal(athleteId, onDeclared)
  const [intent, setIntent] = useState('')
  const [weeks, setWeeks] = useState<number | null>(12)

  const error = messageFor(goal.error, labels)
  // The same grapheme count the domain applies, so the counter and the rule can never
  // disagree. A counter that said 199/200 while the constructor rejected the value would
  // be worse than no counter.
  const used = countGraphemes(intent)

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const today = localDate({ epochMs: systemClock.now(), zone })
        goal.submit({
          intent,
          horizon: weeks === null ? null : addDays(today, weeks * 7),
          cadenceDays: DEFAULT_CADENCE_DAYS,
        })
      }}
    >
      <div>
        <label htmlFor="intent" className="text-muted mb-1.5 block text-sm">
          {labels.intentLabel}
        </label>
        {/*
          A textarea, not an input. The athlete is writing a sentence about what they want,
          and a single-line field that scrolls sideways discourages them from finishing it —
          which costs the one piece of information this whole context exists to hold.

          No `dir` override: this is PROSE, so it inherits the page's direction. The
          numeric fields elsewhere force LTR; doing that here would render a Persian
          sentence left-aligned and backwards.
        */}
        <textarea
          id="intent"
          name="intent"
          rows={3}
          value={intent}
          maxLength={MAX_INTENT_LENGTH * 2}
          onChange={(event) => {
            setIntent(event.target.value)
          }}
          placeholder={labels.intentPlaceholder}
          aria-describedby="intent-hint"
          {...(error === null
            ? {}
            : { 'aria-invalid': true, 'aria-errormessage': 'goal-error' })}
          className="border-default bg-surface-elevated text-primary focus:border-brand-border w-full resize-none rounded-md border px-4 py-3 outline-none"
        />
        <p id="intent-hint" className="text-disabled mt-1.5 flex justify-between gap-4 text-xs">
          <span>{labels.intentHint}</span>
          <span className="nums shrink-0">
            {used}/{MAX_INTENT_LENGTH}
          </span>
        </p>
      </div>

      <fieldset>
        <legend className="text-muted mb-2 text-sm">{labels.horizonLabel}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEK_OPTIONS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={weeks === option ? 'primary' : 'secondary'}
              aria-pressed={weeks === option}
              onPress={() => {
                setWeeks(option)
              }}
            >
              <span className="nums">{normalizeDigits(String(option))}</span>
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={weeks === null ? 'primary' : 'secondary'}
            aria-pressed={weeks === null}
            onPress={() => {
              setWeeks(null)
            }}
          >
            {labels.horizonOpenEnded}
          </Button>
        </div>
        <p className="text-disabled mt-1.5 text-xs">{labels.horizonHint}</p>
      </fieldset>

      {error !== null && (
        <p role="alert" id="goal-error" className="text-error-fg text-sm">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <Button type="submit" size="lg" className="w-full" isDisabled={goal.isSubmitting}>
          {labels.submit}
        </Button>
        {/*
          Skippable, deliberately. A goal declared to get past a form is worse than no
          goal: it becomes the thing every future prescription and evaluation is judged
          against. Better to let the athlete arrive without one and declare it when they
          have something they actually want.
        */}
        <Button type="button" variant="ghost" className="w-full" onPress={onSkip}>
          {labels.skip}
        </Button>
      </div>
    </form>
  )
}
