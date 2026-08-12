import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { enableStaticRendering } from '../../../src/i18n/static'

/**
 * The coach surface.
 *
 * ## One app, two route groups — not two apps (ADR-0036)
 *
 * A Person may be both an athlete and a coach, so two apps would mean two sessions for a cookie
 * ADR-0025 deliberately made same-origin; a duplicated composition root; and two SSE streams against a
 * six-connections-per-origin budget that is per ORIGIN, not per app. The bundle argument does not
 * apply, because the budget is already per route.
 *
 * ## This group is organisation, never a control
 *
 * Nothing here decides authorisation. Every subject-scoped read and write is checked server-side by
 * the `subject()` resolver regardless of which route reached it, and a coach who types an athlete id
 * they have no engagement with gets a 404 from the API rather than a rendered page (ADR-0036).
 *
 * ## No `force-dynamic` here, and no athlete prefetch
 *
 * The athlete group prefetches `myAthleteQuery` because every route in it needs the signed-in
 * athlete. A coach's subject comes from the URL, so there is nothing group-wide to warm — prefetching
 * would make the roster pay for a query it does not use.
 */
export default async function CoachLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('coach')

  return (
    <div className="min-h-dvh">
      <header className="border-default bg-surface/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2">
          <span className="text-display text-primary">{t('name')}</span>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/roster" className="text-muted hover:text-primary transition-colors">
              {t('nav.roster')}
            </Link>
            {/*
              A link back to one's own training, because a coach who trains is ONE identity rather than
              two accounts — which is the whole reason this is a route group and not a second app.
            */}
            <Link href="/dashboard" className="text-muted hover:text-primary transition-colors">
              {t('nav.myTraining')}
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  )
}
