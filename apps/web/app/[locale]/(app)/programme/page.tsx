import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'
import { ProgrammeClient } from './programme-client'

/**
 * The athlete's programme. Read-only — see the note in `ProgramView`.
 *
 * Dynamic via the `(app)` layout's `force-dynamic`. No prefetch here yet: the `(app)` layout
 * prefetches the athlete because every route in the group needs it, whereas the programme is
 * needed by this route alone. Prefetching it in the layout would make every dashboard visit
 * pay for a query it does not use.
 */
export default async function ProgrammePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('programme')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <ProgrammeClient
        locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
        labels={{
          title: t('title'),
          version: t('version'),
          noProgram: t('noProgram'),
          noProgramHint: t('noProgramHint'),
          progression: {
            fixed: t('progression.fixed'),
            linear: t('progression.linear'),
            autoregulated: t('progression.autoregulated'),
          },
          ratePerCycle: t('ratePerCycle'),
          authoredByHuman: t('authoredByHuman'),
          authoredByAssistant: t('authoredByAssistant'),
          loading: t('loading'),
          failed: t('failed'),
        }}
      />
    </main>
  )
}
