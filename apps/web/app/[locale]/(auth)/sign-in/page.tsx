import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { Card, CardDescription, CardTitle, Skeleton } from '@fitnessos/ui'
import { enableStaticRendering } from '../../../../src/i18n/static'
import { SignInClient } from './sign-in-client'

/**
 * Sign-in. A server component wrapping a client leaf.
 *
 * The `(auth)` group rather than `(app)`: this must be reachable without a session,
 * and the middleware guard covers `(app)` paths only.
 *
 * `<Suspense>` around the client leaf is required, not decorative: `SignInClient` reads
 * `useSearchParams()` for the post-sign-in redirect target, and without a boundary that read
 * suspends the whole page.
 *
 * Labels are resolved here, on the server, and passed down as plain strings. The Auth
 * context therefore needs no dependency on the app's i18n runtime, and `SignInForm`
 * can be rendered in a component test without standing that runtime up.
 */
/*
 * Rendered per request, NOT prerendered — and the reason is the CSP nonce.
 *
 * A nonce is generated per request in middleware and stamped onto every script tag Next emits.
 * A page prerendered at build time has no nonce in its HTML, so under `script-src 'nonce-…'
 * 'strict-dynamic'` every one of its own scripts is refused and the page is inert.
 *
 * Three ways out, and only one is defensible:
 *
 *   drop the nonce                    the header stops meaning anything
 *   nonce-free policy for this route  weakens exactly the page where an injected script is worth
 *                                     the most to an attacker
 *   render per request                costs a render of a page that fetches nothing
 *
 * So: per request. The previous `generateStaticParams` here is gone, and with it the reason for
 * the note about `useSearchParams` opting the route out of prerendering — there is no longer a
 * prerender to opt out of. The `<Suspense>` boundary stays, because it is still what keeps the
 * search-param read from suspending the whole page.
 */
export const dynamic = 'force-dynamic'

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
