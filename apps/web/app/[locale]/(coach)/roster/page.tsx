import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { RosterClient } from './roster-client'

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'coach' })
  return { title: t('roster.heading') }
}

/**
 * Who this coach may act on right now.
 *
 * ACTIVE engagements only. A proposed one confers nothing (ADR-0034), so listing it here would put an
 * athlete in a coach's roster before they had agreed to be there — and the coach would reasonably read
 * the list as people they can help.
 */
export default async function RosterPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'coach' })

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('roster.heading')}</h1>
      <RosterClient
        labels={{
          empty: t('roster.empty'),
          emptyHint: t('roster.emptyHint'),
          loading: t('roster.loading'),
          failed: t('roster.failed'),
          open: t('roster.open'),
          expires: t('roster.expires'),
        }}
      />
    </main>
  )
}
