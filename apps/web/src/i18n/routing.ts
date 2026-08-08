import { defineRouting } from 'next-intl/routing'

/**
 * Persian is the default locale and is not prefixed; English is.
 *
 * `localePrefix: 'as-needed'` rather than 'always' because the primary market
 * reads Persian, and making the majority of users carry `/fa` in every URL is a
 * cost paid on every link, share and bookmark for the benefit of symmetry.
 */
export const routing = defineRouting({
  locales: ['fa', 'en'],
  defaultLocale: 'fa',
  localePrefix: 'as-needed',

  /**
   * Header-based negotiation is OFF, and this was a bug found by the e2e suite
   * rather than a preference.
   *
   * With detection on, `Accept-Language: en-US` won over `defaultLocale`, so a
   * visit to `/` redirected to `/en`. Windows installations in Iran commonly report
   * en-US regardless of who is using them — so the primary market's users were being
   * sent to the secondary language by a header that says nothing about what they
   * read. The request-based e2e check passed the whole time, because a bare
   * `request.get('/')` sends no Accept-Language at all; only the browser-driven
   * check caught it.
   *
   * With it off, `/` is Persian, always, and `/en` is an explicit choice. next-intl's
   * `Link` preserves the active locale, so navigation within English stays English —
   * the only thing that changes is that a fresh visit to the bare origin is no longer
   * decided by a header nobody set deliberately.
   */
  localeDetection: false,
})

export type AppLocale = (typeof routing.locales)[number]

/** RTL is a property of the locale, so it is derived here and never stored. */
export const isRtlLocale = (locale: string): boolean => locale === 'fa'
