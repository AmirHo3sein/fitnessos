import { getTranslations } from 'next-intl/server'
import { Card, CardDescription, CardTitle } from '@fitnessos/ui'
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
 * The onboarding flow itself — training identity, availability, first goal — is Phase
 * 2 and belongs to the Athlete and Goal contexts. This is the landing point and the
 * shell around it, deliberately not a stub of the questions: a placeholder form that
 * collects nothing is indistinguishable from a broken one during review.
 */
export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('onboarding')

  return (
    <main className="mx-auto max-w-md">
      <Card>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </Card>
    </main>
  )
}
