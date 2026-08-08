import { getTranslations } from 'next-intl/server'
import { AthleteSummary } from '@fitnessos/core/presentation'
import { hasLocale } from 'next-intl'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'

/**
 * A server component that renders a client leaf.
 *
 * The translated labels are resolved HERE, on the server, and passed down as a
 * plain object. That is deliberate: `AthleteSummary` lives in a bounded context
 * package, and a context that imported next-intl would take on a dependency on the
 * app's routing runtime — `no-next-outside-app` blocks the server half of that
 * outright, and the client half would make the component impossible to render in a
 * component test without standing up the whole i18n stack.
 *
 * The data it renders was already prefetched by the `(app)` layout, so it mounts
 * with a populated cache and no loading flash.
 */
/**
 * Inherited from the `(app)` layout in principle; declared again here because the
 * layout's `force-dynamic` alone did not stop this page being prerendered — the
 * ancestor `generateStaticParams` still won. Route-segment config is resolved per
 * segment, so the segment that actually renders has to say it.
 */
export const dynamic = 'force-dynamic'

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('athlete.summary')
  const page = await getTranslations('dashboard')

  return (
    <main>
      <h1 className="text-display mb-6 text-2xl">{page('title')}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <AthleteSummary
          locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
          labels={{
            title: t('title'),
            experience: {
              beginner: t('experience.beginner'),
              intermediate: t('experience.intermediate'),
              advanced: t('experience.advanced'),
            },
            daysPerWeek: t('daysPerWeek'),
            ceiling: t('ceiling'),
            noCeiling: t('noCeiling'),
            loading: t('loading'),
            failed: t('failed'),
          }}
        />
      </div>
    </main>
  )
}
