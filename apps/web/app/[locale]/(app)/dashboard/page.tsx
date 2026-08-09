import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AthleteSummary } from '@fitnessos/core/athlete/presentation'
import { IndicatorList } from '@fitnessos/core/measurement/presentation'
import { UnjudgedHypotheses } from '@fitnessos/core/learning/presentation'
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
  const t = await getTranslations({ locale, namespace: 'dashboard' })
  return { title: t('title') }
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('athlete.summary')
  const page = await getTranslations('dashboard')
  const indicators = await getTranslations('measurement')
  const unjudged = await getTranslations('learning.unjudged')

  /*
   * Today, resolved on the SERVER and passed down.
   *
   * Staleness is derived (ADR-0006), so it is computed from this date rather than from a clock
   * inside the component. A `new Date()` in the client would also differ between the server
   * render and hydration — a mismatch React resolves in favour of whichever ran second, which
   * means the warning flickers on for some athletes and not others.
   */
  const now = new Date()
  const asOf = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }

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

      {/*
        ABOVE the indicators. An unanswered obligation is a question the coach owes an answer to;
        the indicators are information they can browse. Putting the debt below the browsing is how
        it stops being read.
      */}
      <div className="mt-6">
        <UnjudgedHypotheses
          locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
          asOf={asOf}
          labels={{
            title: unjudged('title'),
            intro: unjudged('intro'),
            claim: unjudged('claim'),
            dueOn: unjudged('dueOn'),
            overdue: unjudged('overdue'),
            held: unjudged('held'),
            didNotHold: unjudged('didNotHold'),
            rationaleLabel: unjudged('rationaleLabel'),
            rationalePlaceholder: unjudged('rationalePlaceholder'),
            submit: unjudged('submit'),
            rationaleRequired: unjudged('rationaleRequired'),
          }}
        />
      </div>

      <div className="mt-6">
        <IndicatorList
          locale={hasLocale(routing.locales, locale) ? locale : routing.defaultLocale}
          asOf={asOf}
          labels={{
            title: indicators('title'),
            none: indicators('none'),
            noneHint: indicators('noneHint'),
            measuredOn: indicators('measuredOn'),
            stale: indicators('stale'),
            notEnoughData: indicators('notEnoughData'),
            kinds: {
              bodyweight: indicators('kinds.bodyweight'),
              'estimated-1rm': indicators('kinds.estimatedOneRepMax'),
            },
          }}
        />
      </div>
    </main>
  )
}
