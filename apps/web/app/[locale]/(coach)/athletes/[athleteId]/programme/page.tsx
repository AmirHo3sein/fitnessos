import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from '../../../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../../../src/i18n/static'
import { ProgrammeClient } from '../../../../(app)/programme/programme-client'
import { programmeLabels } from '../../../../_shared/programme-labels'

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'programme' })
  return { title: t('heading') }
}

/**
 * An athlete's programme, as their coach sees it.
 *
 * **The same `ProgrammeClient` and the same words as the athlete's own route.** The only difference is
 * the subject the ports resolve, which the layout above supplies from the URL — the editor cannot tell
 * which surface it is mounted on, and nothing about a programme changes depending on who is looking at
 * it (ADR-0036).
 *
 * Duplicating the editor here was the obvious alternative and would have been two Program Builders
 * diverging from the first bug fixed in one of them.
 */
export default async function CoachProgrammePage({
  params,
}: {
  params: Promise<{ locale: string; athleteId: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('programme')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <ProgrammeClient
        locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
        labels={programmeLabels(t)}
      />
    </main>
  )
}
