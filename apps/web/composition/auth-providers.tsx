'use client'

import { AuthPortsProvider } from '@fitnessos/core/auth/presentation'
import { useMemo, type ReactNode } from 'react'
import { createAuthPorts } from './auth'
import { createHttp } from './container'

/**
 * Port providers for the `(auth)` route group.
 *
 * The second application of the rule from ADR-0031: ports are provided by the route
 * group that uses them. Auth ports are useless inside `(app)` — the session already
 * exists there — and athlete ports are unreachable here, which is correct, since
 * nothing on this screen has an athlete to read.
 *
 * No `onSessionLost`. These are the two endpoints that run *without* a session, so
 * there is nothing to lose and nowhere to redirect to: the user is already on the
 * sign-in page.
 */
export const AuthProviders = ({ children }: { children: ReactNode }) => {
  // Stable reference, for the same reason as everywhere else: React Context is used
  // for dependency injection only, and a value that changed identity on re-render
  // would re-render every consumer with it.
  const ports = useMemo(() => createAuthPorts(createHttp({ mode: 'browser' })), [])
  return <AuthPortsProvider value={ports}>{children}</AuthPortsProvider>
}
