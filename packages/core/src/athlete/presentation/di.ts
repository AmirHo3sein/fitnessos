'use client'

import type { AthletePorts } from '../application/index'
import { createDiContext } from '@fitnessos/ui'

/**
 * The Athlete context's dependency-injection seam.
 *
 * This is how B1 is satisfied without a waiver. Presentation cannot import
 * `@fitnessos/infra` (`no-presentation-to-infra`), but it still has to *reach* the
 * ports. The container can only be built where infra is visible, which is
 * `apps/web/composition` — and a hook imported from the app would point the
 * dependency backwards.
 *
 * So each context declares its own typed context here, over its own ports only,
 * and the app mounts it with a concrete instance. Nothing points inward from the
 * app, and no context can see another's ports even by accident.
 *
 * `'use client'` is required, not decorative: `createDiContext` calls
 * `createContext` at module scope, and a server component that merely imported
 * this file transitively would fail the build with "attempted to call
 * createDiContext() from the server". The directive is what makes this a client
 * module reference on the server rather than server-evaluated code.
 */
const { Provider, useDi } = createDiContext<AthletePorts>('Athlete')

export { Provider as AthletePortsProvider, useDi as useAthletePorts }
