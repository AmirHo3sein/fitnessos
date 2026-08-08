import { myAthleteQuery } from '@fitnessos/core/athlete'
import { HydrationBoundary, dehydrate } from '@tanstack/react-query'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { AppProviders } from '../../../composition/app-providers'
import { createQueryClient } from '../../../composition/query-client'
import { createServerAthletePorts } from '../../../composition/server'
import { Link } from '../../../src/i18n/navigation'
import { enableStaticRendering } from '../../../src/i18n/static'

/**
 * The authenticated shell — and the reference implementation of the RSC prefetch
 * pattern (handbook §3.3). Every protected route group should look like this.
 *
 * The mechanism, and why each part is load-bearing:
 *
 *   1. A QueryClient is created PER REQUEST. Never a module-level one: a single
 *      Node process serves many users, and a shared client would hand one
 *      athlete's cached profile to the next request that rendered.
 *
 *   2. `prefetchQuery` is given the SAME definition object the client hook uses
 *      (`myAthleteQuery`), from the application layer. This is the whole reason
 *      query definitions live outside presentation. If the server built its own
 *      key or its own fetcher, the two could drift — and the failure mode is not
 *      an error, it is a silent double-fetch that nobody notices until someone
 *      reads a waterfall.
 *
 *   3. `prefetchQuery` rather than `fetchQuery`: prefetch does not throw. A failed
 *      prefetch should degrade to the client fetching normally and showing its own
 *      error state, not take down the entire shell for every child route.
 *
 *   4. `dehydrate` + `<HydrationBoundary>` seeds the browser cache, so the client
 *      component mounts with data already present. No loading flash, no second
 *      request. Without the non-zero `staleTime` in `createQueryClient`, step 4
 *      would be wasted work — the client would refetch on mount regardless.
 *
 * This layout is a server component. `'use client'` belongs on the leaves that
 * genuinely need interactivity, and nowhere above them.
 */
/**
 * Explicitly dynamic, and this is not belt-and-braces.
 *
 * Reading `cookies()` is *supposed* to opt a route out of prerendering, but the
 * first build of this shell emitted it as SSG anyway — a page rendered once at
 * build time, with no session, and then served from cache. Relying on an inferred
 * opt-out for an authenticated route means one framework change away from serving
 * every user the same cached shell.
 *
 * The cost is that this route group is never static. That is the correct trade:
 * nothing behind a session is cacheable at build time regardless.
 */
export const dynamic = 'force-dynamic'

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)

  const [t, athletePorts] = await Promise.all([
    getTranslations('app'),
    createServerAthletePorts(),
  ])

  const queryClient = createQueryClient()
  await queryClient.prefetchQuery(myAthleteQuery(athletePorts))

  const nav = [
    { href: '/dashboard', label: t('nav.dashboard') },
    { href: '/programme', label: t('nav.programme') },
    { href: '/sessions', label: t('nav.sessions') },
    { href: '/settings', label: t('nav.settings') },
  ] as const

  return (
    <div className="min-h-dvh">
      <header className="border-line bg-surface/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
          <span className="text-display text-fg">{t('name')}</span>
          <nav className="flex items-center gap-4 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted hover:text-fg transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">
        <HydrationBoundary state={dehydrate(queryClient)}>
          <AppProviders>{children}</AppProviders>
        </HydrationBoundary>
      </div>
    </div>
  )
}
