import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { WorkflowWorkspace } from '@fitnessos/ctx-workflow/presentation'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'

/** The Workflow Builder's route. */
export const dynamic = 'force-dynamic'

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'automation' })
  return { title: t('heading') }
}

export default async function AutomationPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('automation')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <WorkflowWorkspace
        locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
        labels={{
          title: t('title'),
          none: t('none'),
          noneHint: t('noneHint'),
          create: t('create'),
          loading: t('loading'),
          saveFailed: t('saveFailed'),
          newTitle: t('newTitle'),
          firstTrigger: t('firstTrigger'),
          builder: {
            heading: t('builder.heading'),
            addTrigger: t('builder.addTrigger'),
            addCondition: t('builder.addCondition'),
            addAction: t('builder.addAction'),
            removeStep: t('builder.removeStep'),
            undo: t('builder.undo'),
            redo: t('builder.redo'),
            save: t('builder.save'),
            detail: t('builder.detail'),
            connectFrom: t('builder.connectFrom'),
            connectTo: t('builder.connectTo'),
            connect: t('builder.connect'),
            disconnect: t('builder.disconnect'),
            empty: t('builder.empty'),
            newTrigger: t('builder.newTrigger'),
            newCondition: t('builder.newCondition'),
            newAction: t('builder.newAction'),
            steps: t('builder.steps'),
            canvas: t('builder.canvas'),
            enable: t('builder.enable'),
            disable: t('builder.disable'),
            notRunnable: t('builder.notRunnable'),
            noTrigger: t('builder.noTrigger'),
            node: {
              trigger: t('builder.node.trigger'),
              condition: t('builder.node.condition'),
              action: t('builder.node.action'),
              branchTrue: t('builder.node.branchTrue'),
              branchFalse: t('builder.node.branchFalse'),
              unreachable: t('builder.node.unreachable'),
            },
            refusal: {
              'missing-node': t('builder.refusal.missing-node'),
              'unknown-port': t('builder.refusal.unknown-port'),
              'trigger-input': t('builder.refusal.trigger-input'),
              'self-loop': t('builder.refusal.self-loop'),
              cycle: t('builder.refusal.cycle'),
              'port-taken': t('builder.refusal.port-taken'),
              duplicate: t('builder.refusal.duplicate'),
            },
          },
        }}
      />
    </main>
  )
}
