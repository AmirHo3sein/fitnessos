import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { NutritionWorkspace } from '@fitnessos/ctx-nutrition/presentation'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'

/** The Nutrition Builder's route. */
export const dynamic = 'force-dynamic'

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nutrition' })
  return { title: t('heading') }
}

export default async function NutritionPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('nutrition')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{t('heading')}</h1>
      <NutritionWorkspace
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
          conflictTitle: t('conflictTitle'),
          conflictBody: t('conflictBody'),
          conflictKeep: t('conflictKeep'),
          conflictDiscard: t('conflictDiscard'),
          conflictDismiss: t('conflictDismiss'),
          newTitle: t('newTitle'),
          firstMeal: t('firstMeal'),
          firstMealWhen: t('firstMealWhen'),
          builder: {
            heading: t('builder.heading'),
            addMeal: t('builder.addMeal'),
            removeMeal: t('builder.removeMeal'),
            addItem: t('builder.addItem'),
            removeItem: t('builder.removeItem'),
            undo: t('builder.undo'),
            redo: t('builder.redo'),
            save: t('builder.save'),
            mealName: t('builder.mealName'),
            mealWhen: t('builder.mealWhen'),
            food: t('builder.food'),
            amount: t('builder.amount'),
            moveTo: t('builder.moveTo'),
            newMealName: t('builder.newMealName'),
            newFood: t('builder.newFood'),
            newAmount: t('builder.newAmount'),
            empty: t('builder.empty'),
            noItems: t('builder.noItems'),
          },
        }}
      />
    </main>
  )
}
