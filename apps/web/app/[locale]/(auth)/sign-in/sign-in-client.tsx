'use client'

import { SignInForm, type SignInLabels } from '@fitnessos/core/auth/presentation'
import { useSearchParams } from 'next/navigation'
import { AuthProviders } from '../../../../composition/auth-providers'
import { useRouter } from '../../../../src/i18n/navigation'

/**
 * The client leaf for sign-in. Labels are resolved on the server and arrive as plain
 * strings, so the Auth context stays free of a dependency on the app's i18n runtime.
 */
export const SignInClient = ({ labels }: { labels: SignInLabels }) => {
  const router = useRouter()
  const params = useSearchParams()

  return (
    <AuthProviders>
      <SignInForm
        labels={labels}
        onSignedIn={(session) => {
          if (session.isNewPerson) {
            router.replace('/onboarding')
            return
          }

          // `next` comes from the middleware redirect and is therefore attacker-
          // controllable — anyone can send a link with ?next=https://evil.example.
          // Only a same-site absolute path is accepted; anything else falls back to
          // the dashboard. A protocol-relative `//evil.example` is a path by the
          // first test and an open redirect by every other measure, so it is
          // excluded explicitly.
          const next = params.get('next')
          const safe = next !== null && next.startsWith('/') && !next.startsWith('//')
          router.replace(safe ? next : '/dashboard')
        }}
      />
    </AuthProviders>
  )
}
