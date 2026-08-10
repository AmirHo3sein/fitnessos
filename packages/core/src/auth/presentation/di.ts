'use client'

import { createDiContext } from '@fitnessos/ui'
import type { AuthPorts } from '../application/ports/index'

/**
 * The Auth context's DI seam.
 *
 * Mounted by the `(auth)` route group, not by the root layout and not by `(app)` —
 * sign-in must work without a session, and the authenticated area has no use for
 * these ports. That is the rule ADR-0031 established, and Auth is the first context
 * to demonstrate it generalises beyond the one it was derived from.
 */
const { Provider, useDi } = createDiContext<AuthPorts>('Auth')

export { Provider as AuthPortsProvider, useDi as useAuthPorts }
