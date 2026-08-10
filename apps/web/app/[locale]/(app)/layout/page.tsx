import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { DashboardWorkspace } from '@fitnessos/ctx-dashboard/presentation'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'

/**
 * The Dashboard Builder's route.
 *
 * `/layout` rather than `/dashboard`, which is taken by the athlete's actual dashboard. The
 * distinction is real: one is the screen, the other is arranging it.
 */
export const dynamic = 'force-dynamic'

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'layout' })
  return { title: t('heading') }
}

export default async function LayoutPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('layout')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <DashboardWorkspace
        locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
        labels={{
          title: t('title'),
          none: t('none'),
          noneHint: t('noneHint'),
          create: t('create'),
          loading: t('loading'),
          loadFailed: t('loadFailed'),
          retry: t('retry'),
          saveFailed: t('saveFailed'),
          newTitle: t('newTitle'),
          builder: {
            heading: t('builder.heading'),
            addWidget: t('builder.addWidget'),
            removeWidget: t('builder.removeWidget'),
            undo: t('builder.undo'),
            redo: t('builder.redo'),
            save: t('builder.save'),
            newWidgetLabel: t('builder.newWidgetLabel'),
            empty: t('builder.empty'),
            keyboardHint: t('builder.keyboardHint'),
            widgetMovable: t('builder.widgetMovable'),
            content: {
              'upcoming-sessions': t('builder.content.upcoming-sessions'),
              'unjudged-proposals': t('builder.content.unjudged-proposals'),
            },
          },
        }}
      />
    </main>
  )
}
