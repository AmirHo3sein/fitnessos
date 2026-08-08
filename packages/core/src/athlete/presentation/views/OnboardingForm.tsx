'use client'

import { Button } from '@fitnessos/ui'
import { normalizeDigits } from '@fitnessos/kernel'
import { useState } from 'react'
import { OnboardingValidationError, type AthleteSnapshot } from '../../application/index'
import { EXPERIENCE_LEVELS, type ExperienceLevel } from '../../domain/vocabulary'
import { useCompleteOnboarding } from '../hooks/useCompleteOnboarding'

export interface OnboardingLabels {
  readonly experienceLabel: string
  readonly experience: Readonly<Record<string, string>>
  readonly disciplinesLabel: string
  readonly disciplines: Readonly<Record<string, string>>
  readonly daysLabel: string
  readonly ceilingLabel: string
  readonly ceilingHint: string
  readonly submit: string
  readonly errors: Readonly<Record<string, string>>
}

export interface OnboardingFormProps {
  labels: OnboardingLabels
  /** Slugs offered as discipline options. Reference data, resolved by the app. */
  disciplineOptions: readonly string[]
  onComplete: (athlete: AthleteSnapshot) => void
}

/**
 * Onboarding: experience, disciplines, days per week, optional session ceiling.
 *
 * Everything the domain rejects is reported against the field that caused it, because
 * `OnboardingValidationError` carries the section. An error that says only "invalid"
 * makes the athlete re-check four fields to find the one that was wrong.
 */
const messageFor = (error: Error | null, labels: OnboardingLabels): string | null => {
  if (error === null) return null
  if (error instanceof OnboardingValidationError) {
    return labels.errors[error.problem.reason.kind] ?? labels.errors['generic'] ?? null
  }
  return labels.errors['generic'] ?? null
}

export const OnboardingForm = ({
  labels,
  disciplineOptions,
  onComplete,
}: OnboardingFormProps) => {
  const onboarding = useCompleteOnboarding(onComplete)

  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('beginner')
  const [disciplines, setDisciplines] = useState<readonly string[]>([])
  const [days, setDays] = useState('3')
  const [ceilingMinutes, setCeilingMinutes] = useState('')

  const error = messageFor(onboarding.error, labels)

  const toggle = (slug: string) => {
    setDisciplines((current) =>
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    )
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()

        // Persian digits again. Every numeric field in this product needs this, and
        // these two are typed rather than picked, so they are exactly where it matters.
        const parsedDays = Number(normalizeDigits(days))
        const parsedMinutes = normalizeDigits(ceilingMinutes).trim()

        onboarding.submit({
          trainingIdentity: {
            experienceLevel,
            // Not collected here. Asking "how many months have you trained?" in an
            // onboarding form gets a guess, and a guess in a progression input is worse
            // than a null the system knows is absent.
            trainingAgeMonths: null,
            disciplines,
          },
          availability: {
            daysPerWeek: parsedDays,
            // Minutes in the UI, seconds on the wire — N11 forbids an ambiguous
            // magnitude, so the conversion happens once, here, next to the input whose
            // unit is named in its own label.
            sessionCeilingSeconds: parsedMinutes === '' ? null : Number(parsedMinutes) * 60,
            equipmentAccess: [],
          },
        })
      }}
    >
      <fieldset>
        <legend className="text-muted mb-2 text-sm">{labels.experienceLabel}</legend>
        <div className="flex gap-2">
          {EXPERIENCE_LEVELS.map((level) => (
            <Button
              key={level}
              type="button"
              variant={experienceLevel === level ? 'primary' : 'secondary'}
              onPress={() => {
                setExperienceLevel(level)
              }}
            >
              {labels.experience[level] ?? level}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-muted mb-2 text-sm">{labels.disciplinesLabel}</legend>
        <div className="flex flex-wrap gap-2">
          {disciplineOptions.map((slug) => (
            <Button
              key={slug}
              type="button"
              size="sm"
              variant={disciplines.includes(slug) ? 'primary' : 'secondary'}
              // A toggle is a toggle, not a button. Without this a screen reader
              // announces "button" and never reports whether it is on.
              aria-pressed={disciplines.includes(slug)}
              onPress={() => {
                toggle(slug)
              }}
            >
              {labels.disciplines[slug] ?? slug}
            </Button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="days" className="text-muted mb-1.5 block text-sm">
          {labels.daysLabel}
        </label>
        <input
          id="days"
          name="days"
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={days}
          onChange={(event) => {
            setDays(event.target.value)
          }}
          className="border-line bg-elevated text-fg focus:border-accent nums h-12 w-full rounded-md border px-4 outline-none"
        />
      </div>

      <div>
        <label htmlFor="ceiling" className="text-muted mb-1.5 block text-sm">
          {labels.ceilingLabel}
        </label>
        <input
          id="ceiling"
          name="ceiling"
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={ceilingMinutes}
          onChange={(event) => {
            setCeilingMinutes(event.target.value)
          }}
          aria-describedby="ceiling-hint"
          className="border-line bg-elevated text-fg focus:border-accent nums h-12 w-full rounded-md border px-4 outline-none"
        />
        <p id="ceiling-hint" className="text-faint mt-1.5 text-xs">
          {labels.ceilingHint}
        </p>
      </div>

      {error !== null && (
        <p role="alert" id="onboarding-error" className="text-danger text-sm">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" isDisabled={onboarding.isSubmitting}>
        {labels.submit}
      </Button>
    </form>
  )
}
