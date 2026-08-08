import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'
import { SessionsClient } from './sessions-client'

/**
 * Upcoming prescribed sessions. Read-only.
 *
 * Logging what was actually performed is not here. It is a write path against a live session
 * with offline requirements — `infra/sync`, storage adapters, `serialization/migrate` — none
 * of which exists yet. A logger that silently loses a set an athlete completed in a basement
 * gym with no signal is worse than no logger, and that is the normal case rather than the
 * edge case.
 */
export default async function SessionsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('sessions')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <SessionsClient
        locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
        labels={{
          title: t('title'),
          none: t('none'),
          noneHint: t('noneHint'),
          setsReps: t('setsReps'),
          bodyweight: t('bodyweight'),
          screening: {
            clear: t('screening.clear'),
            modified: t('screening.modified'),
            blocked: t('screening.blocked'),
          },
          basisWithheld: t('basisWithheld'),
          loading: t('loading'),
          failed: t('failed'),
        }}
      />
    </main>
  )
}
