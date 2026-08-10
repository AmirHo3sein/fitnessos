import { NextIntlClientProvider } from 'next-intl'
import { hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Vazirmatn } from 'next/font/google'
import type { ReactNode } from 'react'
import { QueryProviders } from '../../composition/query-providers'
import { isRtlLocale, routing } from '../../src/i18n/routing'
import '../globals.css'
import { enableStaticRendering } from '../../src/i18n/static'

const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  variable: '--font-vazirmatn',
  display: 'swap',
})

/**
 * `generateStaticParams` is deliberately NOT here, even though next-intl's own
 * guidance puts it in the locale layout.
 *
 * That guidance assumes every route is static. Ours are not. Declaring the params
 * on this shared layout prerendered *all* descendants for both locales — including
 * `(app)`, the authenticated group — and it did so even with `force-dynamic` on
 * both the group layout and the page. An authenticated shell rendered once at
 * build time with no session, then served from cache, is not something to leave to
 * an inferred opt-out.
 *
 * So each statically-generatable route declares its own params. See
 * `(public)/page.tsx` and `(auth)/sign-in/page.tsx`. Adding a public route means
 * adding one export to it; forgetting costs a dynamic render, which is the safe
 * direction to fail in.
 */

/**
 * The document title, and a template every page fills in.
 *
 * There was none at all until an axe audit reported `document-title` on every page — a serious
 * WCAG 2.4.2 failure, and one that is completely invisible while developing, because a browser
 * tab showing a URL looks unremarkable to someone who already knows where they are. It is not
 * unremarkable to a screen-reader user, for whom the title is the first thing announced on every
 * navigation, nor to anyone with twenty tabs open.
 *
 * A template rather than a title per page repeating the product name: `%s · FitnessOS` keeps the
 * distinguishing part first, which is the part that survives a truncated tab.
 */
export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> => {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'app' })
  return {
    title: { template: `%s · ${t('name')}`, default: t('name') },
    /*
     * A description, because Lighthouse's SEO audit was right to ask and because a link shared
     * into a chat with no summary looks broken rather than sparse. Localised: a Persian-language
     * product whose preview text is English is one that reads as translated.
     */
    description: t('description'),
  }
}

/**
 * The root layout. A SERVER component — note the absence of `'use client'`.
 *
 * `dir` and `lang` are set here, from the route param, rather than by an effect
 * after mount. An effect would produce a visible LTR→RTL flip on first paint for
 * every Persian user, on every cold navigation.
 *
 * `<Providers>` is the client boundary, and it is placed as deep as it can go
 * while still being an ancestor of everything that needs a QueryClient. Anything
 * rendered above it stays on the server and costs no bundle.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  // Required for static rendering — without it every page under this layout opts
  // into dynamic rendering the moment it reads a translation.
  enableStaticRendering(locale)

  return (
    <html
      lang={locale}
      dir={isRtlLocale(locale) ? 'rtl' : 'ltr'}
      data-theme="dim"
      suppressHydrationWarning
      className={vazirmatn.variable}
    >
      <body>
        <NextIntlClientProvider>
          <QueryProviders>{children}</QueryProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
