import { getTranslations } from 'next-intl/server'
import { Link } from '../../../src/i18n/navigation'
import { enableStaticRendering } from '../../../src/i18n/static'

/**
 * The marketing page. A pure server component with zero client JavaScript beyond
 * what the layout's provider boundary already ships.
 *
 * `getTranslations` (server) rather than `useTranslations` (client): one pattern
 * per route group, chosen by whether the group needs interactivity. `(public)`
 * does not.
 */
/** Public and cacheable — prerender both locales. See the note in `[locale]/layout.tsx`. */
/*
 * Per request rather than prerendered — see the full note in `(auth)/sign-in/page.tsx`. A
 * prerendered page has no CSP nonce in its HTML, so its own scripts are refused by the policy
 * the middleware sets at runtime.
 */
export const dynamic = 'force-dynamic'

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('public')

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6">
      <h1 className="text-display text-4xl leading-tight sm:text-5xl">{t('headline')}</h1>
      <p className="text-muted mt-4 text-lg">{t('subhead')}</p>
      <div className="mt-8">
        <Link
          href="/sign-in"
          className="bg-action text-action-fg hover:bg-action-hover inline-flex h-12 items-center rounded-lg px-6 font-medium transition-colors"
        >
          {t('signIn')}
        </Link>
      </div>
    </main>
  )
}
