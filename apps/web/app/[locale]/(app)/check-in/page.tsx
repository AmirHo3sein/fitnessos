import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { CheckInFormWorkspace } from '@fitnessos/ctx-measurement/presentation'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'

/**
 * Authoring the check-in form — the Form Builder's route.
 *
 * Dynamic via the `(app)` layout, and declared here as well for the reason recorded on the
 * dashboard: route-segment config is resolved per segment, so the segment that actually renders
 * has to say it.
 */
export const dynamic = 'force-dynamic'

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'checkIn' })
  return { title: t('heading') }
}

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('checkIn')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <CheckInFormWorkspace
        locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
        labels={{
          title: t('title'),
          none: t('none'),
          noneHint: t('noneHint'),
          create: t('create'),
          loading: t('loading'),
          saveFailed: t('saveFailed'),
          newFormTitle: t('newFormTitle'),
          builder: {
            heading: t('builder.heading'),
            addField: t('builder.addField'),
            removeField: t('builder.removeField'),
            undo: t('builder.undo'),
            redo: t('builder.redo'),
            save: t('builder.save'),
            fieldLabel: t('builder.fieldLabel'),
            records: t('builder.records'),
            unit: t('builder.unit'),
            answerKind: {
              number: t('builder.answerKind.number'),
              scale: t('builder.answerKind.scale'),
              choice: t('builder.answerKind.choice'),
            },
            newFieldLabel: t('builder.newFieldLabel'),
            empty: t('builder.empty'),
          },
        }}
      />
    </main>
  )
}
