import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Card, CardDescription, CardTitle } from '@fitnessos/ui'

/**
 * The 404, inside the locale segment so it is rendered per request.
 *
 * Next prerenders the framework's built-in not-found page at build time, which puts it in the one
 * category this app can no longer serve: HTML with no CSP nonce, whose every script the policy
 * then refuses. The page still rendered — it has no interactivity to lose — but it filled the
 * console with violations on every mistyped URL, and a violation stream that is mostly noise is
 * one nobody reads when a real violation appears.
 *
 * Being inside `[locale]` also makes it translated and on-brand, which the framework's default
 * never was.
 */
export const dynamic = 'force-dynamic'

/**
 * Fills the `%s` in the root layout's title template.
 *
 * A 404 whose tab still reads "FitnessOS" is the case a title is most useful for: someone with
 * twenty tabs open needs to see which one went nowhere.
 */
export const metadata: Metadata = { title: 'FitnessOS' }

export default async function NotFound() {
  const t = await getTranslations('notFound')

  return (
    <main className="mx-auto max-w-lg p-6">
      <Card>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('body')}</CardDescription>
        {/*
          A plain anchor, not `<Link>`. This page is the one place in the app most likely to be
          reached with something broken, so its only escape route should not depend on the router
          having hydrated.
        */}
        <a href="/" className="text-brand mt-4 inline-block text-sm underline">
          {t('home')}
        </a>
      </Card>
    </main>
  )
}
