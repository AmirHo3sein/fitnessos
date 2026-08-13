import type { getTranslations } from 'next-intl/server'

type T = Awaited<ReturnType<typeof getTranslations>>

/**
 * The Program Builder's copy, in one place.
 *
 * Extracted when the coach surface arrived, and the extraction IS the point: the athlete route and the
 * coach route render the same `ProgrammeClient` with the same words, differing only in which subject
 * the ports resolve. Two copies of this block would be two catalogues drifting apart, and the first
 * symptom would be a coach and an athlete reading different names for the same block.
 *
 * The seven editors are parameterised by subject, never duplicated (ADR-0036). This file is what makes
 * that true of the copy as well as the code.
 */
export const programmeLabels = (t: T) => ({
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
          conflictDismiss: t('conflictDismiss'),
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
})
