import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { PlanWorkspace } from '@fitnessos/ctx-timeline/presentation'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'

/** The Timeline Builder's route. */
export const dynamic = 'force-dynamic'

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'plan' })
  return { title: t('heading') }
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('plan')

  /*
   * Today, resolved on the SERVER and passed down as an epoch for a new plan.
   *
   * A `new Date()` in the client component would differ between the server render and hydration,
   * and for an epoch that means every phase offset shifts by a day depending on which ran second.
   */
  const now = new Date()
  const today = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <PlanWorkspace
        locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
        today={today}
        labels={{
          title: t('title'),
          none: t('none'),
          noneHint: t('noneHint'),
          create: t('create'),
          loading: t('loading'),
          saveFailed: t('saveFailed'),
          newTitle: t('newTitle'),
          firstPhase: t('firstPhase'),
          builder: {
            heading: t('builder.heading'),
            addPhase: t('builder.addPhase'),
            removePhase: t('builder.removePhase'),
            undo: t('builder.undo'),
            redo: t('builder.redo'),
            save: t('builder.save'),
            phaseLabel: t('builder.phaseLabel'),
            newPhaseLabel: t('builder.newPhaseLabel'),
            empty: t('builder.empty'),
            weeks: t('builder.weeks'),
            refused: t('builder.refused'),
            keyboardHint: t('builder.keyboardHint'),
            phaseMovable: t('builder.phaseMovable'),
          },
        }}
      />
    </main>
  )
}
