'use client'

import { usePathname } from 'next/navigation'
import { ErrorPanel } from '../../../src/errors/ErrorPanel'
import { errorLabelsFor } from '../../../src/errors/labels'
import { createTelemetry } from '../../../composition/telemetry'

/**
 * The boundary for the authenticated area, and the reason it is separate from the one a level
 * up: a boundary replaces its own segment and nothing above it, so this one keeps the
 * navigation. An athlete whose programme page throws can still reach their sessions.
 *
 * Catching at the locale level instead would take the whole shell down with one route, which is
 * how a single broken page becomes an unusable product.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const pathname = usePathname()

  return (
    <main>
      <ErrorPanel
        error={error}
        reset={reset}
        telemetry={createTelemetry()}
        labels={errorLabelsFor(pathname)}
      />
    </main>
  )
}
