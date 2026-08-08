import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'
import { ProgrammeClient } from './programme-client'

/**
 * The athlete's programme: read by default, editable through the Program Builder.
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
          servesGoal: t('servesGoal'),
          refs: {
            loading: t('refs.loading'),
            deleted: t('refs.deleted'),
            forbidden: t('refs.forbidden'),
            unnamedGoal: t('refs.unnamedGoal'),
          },
          edit: t('edit'),
          cancel: t('cancel'),
          saveFailed: t('saveFailed'),
          conflictTitle: t('conflictTitle'),
          conflictBody: t('conflictBody'),
          conflictKeep: t('conflictKeep'),
          conflictDiscard: t('conflictDiscard'),
          builder: {
            heading: t('builder.heading'),
            addBlock: t('builder.addBlock'),
            removeBlock: t('builder.removeBlock'),
            undo: t('builder.undo'),
            redo: t('builder.redo'),
            save: t('builder.save'),
            blockName: t('builder.blockName'),
            // Shared with the read view rather than duplicated: the same three words for the same
            // three kinds, so a coach and an athlete never see a block described differently.
            progression: {
              fixed: t('progression.fixed'),
              linear: t('progression.linear'),
              autoregulated: t('progression.autoregulated'),
            },
            rate: t('builder.rate'),
            newBlockName: t('builder.newBlockName'),
            empty: t('builder.empty'),
          },
        }}
      />
    </main>
  )
}
