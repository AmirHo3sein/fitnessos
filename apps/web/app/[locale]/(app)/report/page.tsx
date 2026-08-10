import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { ReportWorkspace } from '@fitnessos/ctx-report/presentation'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'

/** The Report Builder's route. Dynamic for the reason recorded on the dashboard. */
export const dynamic = 'force-dynamic'

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'report' })
  return { title: t('heading') }
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('report')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <ReportWorkspace
        locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
        labels={{
          title: t('title'),
          none: t('none'),
          noneHint: t('noneHint'),
          create: t('create'),
          loading: t('loading'),
          saveFailed: t('saveFailed'),
          newReportTitle: t('newReportTitle'),
          builder: {
            heading: t('builder.heading'),
            addTile: t('builder.addTile'),
            removeTile: t('builder.removeTile'),
            undo: t('builder.undo'),
            redo: t('builder.redo'),
            save: t('builder.save'),
            multiSelect: t('builder.multiSelect'),
            keyboardHint: t('builder.keyboardHint'),
            tileMovable: t('builder.tileMovable'),
            alignLeft: t('builder.alignLeft'),
            alignTop: t('builder.alignTop'),
            distributeX: t('builder.distributeX'),
            newTileLabel: t('builder.newTileLabel'),
            empty: t('builder.empty'),
          },
        }}
      />
    </main>
  )
}
