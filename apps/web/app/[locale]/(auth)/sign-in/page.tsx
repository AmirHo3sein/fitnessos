import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { routing } from '../../../../src/i18n/routing'
import { enableStaticRendering } from '../../../../src/i18n/static'
import { SignInClient } from './sign-in-client'

/**
 * Sign-in. A server component wrapping a client leaf.
 *
 * The `(auth)` group rather than `(app)`: this must be reachable without a session,
 * and the middleware guard covers `(app)` paths only.
 *
 * `<Suspense>` around the client leaf is required, not decorative. `SignInClient`
 * reads `useSearchParams()` for the post-sign-in redirect target, and a component
 * that does so opts its whole route out of prerendering unless it sits inside a
 * suspense boundary — this page would silently stop being static.
 *
 * Labels are resolved here, on the server, and passed down as plain strings. The Auth
 * context therefore needs no dependency on the app's i18n runtime, and `SignInForm`
 * can be rendered in a component test without standing that runtime up.
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
        <div className="mt-6">
          <Suspense fallback={<Skeleton className="h-40 w-full" label={t('loading')} />}>
            <SignInClient
              labels={{
                phoneLabel: t('phone'),
                phonePlaceholder: t('phonePlaceholder'),
                phoneHint: t('phoneHint'),
                sendCode: t('submit'),
                codeLabel: t('code'),
                codeSentTo: t('codeSentTo'),
                verify: t('verify'),
                changeNumber: t('changeNumber'),
                errors: {
                  emptyPhone: t('errors.emptyPhone'),
                  badPhone: t('errors.badPhone'),
                  badCode: t('errors.badCode'),
                  generic: t('errors.generic'),
                },
              }}
            />
          </Suspense>
        </div>
      </Card>
    </main>
  )
}
