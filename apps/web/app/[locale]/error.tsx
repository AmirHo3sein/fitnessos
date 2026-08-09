'use client'

import { usePathname } from 'next/navigation'
import { ErrorPanel } from '../../src/errors/ErrorPanel'
import { errorLabelsFor } from '../../src/errors/labels'
import { createTelemetry } from '../../composition/telemetry'

/**
 * The boundary for everything under a locale — the public page, sign-in, and anything the
 * `(app)` boundary below does not catch first.
 *
 * Labels come from `errorLabelsFor` rather than `useTranslations`. That is not a style choice:
 * reading a translation here pulls the whole message catalogue into every client bundle and blew
 * six route budgets at once. The note in `src/errors/labels.ts` has the numbers.
 *
 * The telemetry sink is built here rather than read from context, for the same reason: a
 * boundary that depended on a provider would be a boundary that fails when the provider is what
 * failed.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const pathname = usePathname()

  return (
    <main className="mx-auto max-w-lg p-6">
      <ErrorPanel
        error={error}
        reset={reset}
        telemetry={createTelemetry()}
        labels={errorLabelsFor(pathname)}
      />
    </main>
  )
}
