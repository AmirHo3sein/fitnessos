import { NextIntlClientProvider } from 'next-intl'
import { hasLocale } from 'next-intl'
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
