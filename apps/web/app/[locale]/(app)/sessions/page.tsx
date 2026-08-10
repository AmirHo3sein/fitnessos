import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'
import { SessionsClient } from './sessions-client'

/**
 * Upcoming prescribed sessions. Read-only.
 *
 * Logging is OFFLINE-FIRST (ADR-0033). A log resolves when it is durable on the device, not when
 * it reaches the server — a basement gym with no signal is the normal case here, not a failure.
 * The confirmation says "saved, will sync" rather than "saved", because telling an athlete their
 * session is on the server when it is in a queue is a lie they would discover at the worst moment.
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
  const t = await getTranslations({ locale, namespace: 'sessions' })
  return { title: t('heading') }
}

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
        logCta={t('logCta')}
        savedOffline={t('logger.savedOffline')}
        cancel={t('cancel')}
        loggerLabels={{
          heading: t('logger.heading'),
          reps: t('logger.reps'),
          load: t('logger.load'),
          bodyweight: t('logger.bodyweight'),
          addSet: t('logger.addSet'),
          save: t('logger.save'),
          noteLabel: t('logger.noteLabel'),
          notePlaceholder: t('logger.notePlaceholder'),
          errors: {
            'no-sets': t('logger.errors.noSets'),
            'reps-not-positive': t('logger.errors.repsNotPositive'),
            'load-not-positive': t('logger.errors.loadNotPositive'),
            'duplicate-set': t('logger.errors.generic'),
            'rpe-out-of-range': t('logger.errors.generic'),
            generic: t('logger.errors.generic'),
          },
        }}
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
        syncIssueLabels={{
          conflictTitle: t('syncIssues.conflictTitle'),
          conflictBody: t('syncIssues.conflictBody'),
          rejectedTitle: t('syncIssues.rejectedTitle'),
          rejectedBody: t('syncIssues.rejectedBody'),
          mine: t('syncIssues.mine'),
          theirs: t('syncIssues.theirs'),
          summary: t('syncIssues.summary'),
          unknownRecord: t('syncIssues.unknownRecord'),
          dismiss: t('syncIssues.dismiss'),
        }}
      />
    </main>
  )
}
