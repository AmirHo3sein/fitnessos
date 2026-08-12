import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'
import { ProgrammeClient } from './programme-client'
import { programmeLabels } from '../../_shared/programme-labels'

/**
 * The athlete's programme: read by default, editable through the Program Builder.
 *
 * Dynamic via the `(app)` layout's `force-dynamic`. No prefetch here yet: the `(app)` layout
 * prefetches the athlete because every route in the group needs it, whereas the programme is
 * needed by this route alone. Prefetching it in the layout would make every dashboard visit
 * pay for a query it does not use.
 */
/**
 * Fills the `%s` in the root layout's title template.
 *
 * Localised through the same catalogue as the page's own heading, so the tab and the h1 cannot
 * drift apart into two different names for one screen.
 */
export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'programme' })
  return { title: t('heading') }
}

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
        labels={programmeLabels(t)}
      />
    </main>
  )
}
