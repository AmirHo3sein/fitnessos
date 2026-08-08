import { getTranslations } from 'next-intl/server'
import { Card, CardDescription, CardTitle } from '@fitnessos/ui'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'

/**
 * Sign-in shell.
 *
 * The OTP form itself is a client leaf and arrives with the auth context; this
 * page is the server-rendered frame around it. Placed in the `(auth)` group
 * rather than `(app)` because it must be reachable without a session — the
 * middleware guard covers `(app)` paths only.
 */
/** Public and cacheable — prerender both locales. See the note in `[locale]/layout.tsx`. */
export const generateStaticParams = () => routing.locales.map((locale) => ({ locale }))

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  enableStaticRendering(locale)
  const t = await getTranslations('auth.signIn')

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Card>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
        {/*
          The phone/OTP form lands here with the Auth context. It is deliberately
          absent rather than stubbed: a placeholder form that posts nowhere is
          indistinguishable from a broken one during review.
        */}
      </Card>
    </main>
  )
}
