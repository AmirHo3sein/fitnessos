import type { ReactNode } from 'react'
import { AppProviders } from '../../../../../composition/app-providers'
import { createFlags } from '../../../../../composition/flags'

/**
 * Everything below this is ABOUT one athlete, and the subject comes from the URL.
 *
 * ADR-0031 has ports provided by the route group that uses them, and the subject arrives from exactly
 * the same place — so it is supplied here, beside them. The athlete group supplies the signed-in
 * athlete's own id; this one supplies the id being coached. The editors below cannot tell the
 * difference, and that is the design: they are parameterised by subject, never duplicated.
 *
 * **This is not a permission check.** A coach with no engagement reaches these pages and every query
 * inside them answers 404 or 403 from the server. Route grouping decides what is rendered, not what is
 * allowed (ADR-0036).
 */
export default async function SubjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ athleteId: string }>
}) {
  const { athleteId } = await params

  return (
    <AppProviders
      liveInvalidation={createFlags().isEnabled('live-invalidation')}
      subject={athleteId}
    >
      {children}
    </AppProviders>
  )
}
