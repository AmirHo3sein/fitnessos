import { getTranslations } from 'next-intl/server'
import { Card, CardDescription, CardTitle } from '@fitnessos/ui'
import { OnboardingClient } from './onboarding-client'
import { enableStaticRendering } from '../../../../src/i18n/static'

/**
 * Onboarding — where a newly verified person lands.
 *
 * This route existed as a redirect target in `sign-in-client.tsx` before it existed as
 * a page, which meant a genuinely new user signing in reached a 404. Nothing in the
 * type system or the test suite covers "this string is a real route", so the gap was
 * invisible until the stub API made `isNewPerson: true` reachable end to end.
 *
 * Inside `(app)`, so the middleware guard covers it: onboarding requires a session,
 * which by definition exists by the time anyone arrives here.
 *
 * Collects training identity and availability. The first goal belongs to the Goal
 * context and is not yet built, so it is absent rather than stubbed.
 *
 * Discipline options are reference data supplied by the app, not hardcoded in the
 * context: the list is a catalogue concern, and a bounded context that owned it would
 * need a catalogue dependency to render a form.
 */
/**
 * Reference data, inline until a catalogue context exists. Slugs, not display names —
 * the label comes from the message catalogue, so adding a locale does not touch this.
 */
const DISCIPLINES = ['strength', 'hypertrophy', 'running', 'cycling', 'mobility'] as const

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('onboarding')
  const g = await getTranslations('goal.declare')

  return (
    <main className="mx-auto max-w-md">
      <Card>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        <div className="mt-6">
          <OnboardingClient
            disciplineOptions={DISCIPLINES}
            goalLabels={{
              intentLabel: g('intentLabel'),
              intentPlaceholder: g('intentPlaceholder'),
              intentHint: g('intentHint'),
              horizonLabel: g('horizonLabel'),
              horizonHint: g('horizonHint'),
              horizonOpenEnded: g('horizonOpenEnded'),
              submit: g('submit'),
              skip: g('skip'),
              errors: {
                empty: g('errors.empty'),
                'too-long': g('errors.tooLong'),
                'horizon-in-past': g('errors.horizonInPast'),
                'horizon-too-near': g('errors.horizonTooNear'),
                'cadence-too-short': g('errors.generic'),
                'cadence-too-long': g('errors.generic'),
                'cadence-not-whole': g('errors.generic'),
                generic: g('errors.generic'),
              },
            }}
            athleteLabels={{
              experienceLabel: t('experienceLabel'),
              experience: {
                beginner: t('experience.beginner'),
                intermediate: t('experience.intermediate'),
                advanced: t('experience.advanced'),
              },
              disciplinesLabel: t('disciplinesLabel'),
              disciplines: Object.fromEntries(
                DISCIPLINES.map((slug) => [slug, t(`disciplines.${slug}`)]),
              ),
              daysLabel: t('daysLabel'),
              ceilingLabel: t('ceilingLabel'),
              ceilingHint: t('ceilingHint'),
              submit: t('submit'),
              errors: {
                'days-out-of-range': t('errors.daysOutOfRange'),
                'days-not-whole': t('errors.daysNotWhole'),
                'ceiling-too-short': t('errors.ceilingTooShort'),
                'ceiling-not-positive': t('errors.ceilingNotPositive'),
                'no-disciplines': t('errors.noDisciplines'),
                'unknown-experience-level': t('errors.generic'),
                'training-age-negative': t('errors.generic'),
                'training-age-not-whole': t('errors.generic'),
                'training-age-implausible': t('errors.generic'),
                generic: t('errors.generic'),
              },
            }}
          />
        </div>
      </Card>
    </main>
  )
}
