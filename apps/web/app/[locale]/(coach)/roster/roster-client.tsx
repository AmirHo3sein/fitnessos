'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

interface RosterEntry {
  readonly athleteId: string
  readonly organisationName: string
  readonly expiresAt: string
}

/**
 * The roster.
 *
 * ## Why this reads the API directly instead of through a context port
 *
 * It is not a domain read. It asks **who the CALLER may act on** — a question about the caller rather
 * than about any athlete — so it belongs to no bounded context, and giving it a port would mean adding
 * a reader to a context that has no reason to know about engagements (ADR-0004's orthogonality,
 * ADR-0015's insistence that the Athlete context stay minimal).
 *
 * ## Why its key is `['me', 'roster']`
 *
 * The same reason `athleteKeys.mine()` is unscoped: the answer is about the person asking, and there
 * is no subject yet. The roster is where a subject is CHOSEN, so it cannot be keyed by one.
 */
export const RosterClient = ({
  labels,
}: {
  readonly labels: {
    readonly empty: string
    readonly emptyHint: string
    readonly loading: string
    readonly failed: string
    readonly open: string
    readonly expires: string
  }
}) => {
  const query = useQuery({
    queryKey: ['me', 'roster'],
    queryFn: async ({ signal }): Promise<readonly RosterEntry[]> => {
      // Same-origin (ADR-0025), so the session cookie travels without `credentials: 'include'`.
      const response = await fetch('/api/v1/coach/athletes', { signal })
      if (!response.ok) throw new Error(String(response.status))
      return (await response.json()) as readonly RosterEntry[]
    },
  })

  if (query.isPending) return <p className="text-muted">{labels.loading}</p>

  /*
   * A failed read is NOT an empty roster.
   *
   * Rendering "no athletes yet" for a request that did not complete is the same mistake §4.9 exists to
   * prevent: it invites the coach to conclude something about their athletes from a fact about the
   * network. Here it would be milder than losing an artefact — but it would still have a coach believe
   * an athlete had left.
   */
  if (query.isError) return <p className="text-error">{labels.failed}</p>

  if (query.data.length === 0) {
    return (
      <div>
        <p className="text-muted">{labels.empty}</p>
        <p className="text-muted mt-2 text-sm">{labels.emptyHint}</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {query.data.map((entry) => (
        <li key={entry.athleteId} className="border-default rounded border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-primary">{entry.organisationName}</span>
            <span className="text-muted text-sm">
              {/*
                The expiry is shown because access is TIME-BOUNDED by construction (ADR-0001), and a
                coach who cannot see when it lapses would find out by an athlete disappearing.
              */}
              {labels.expires} {entry.expiresAt.slice(0, 10)}
            </span>
          </div>
          <Link
            href={`/athletes/${entry.athleteId}/programme`}
            className="text-primary mt-2 inline-block text-sm underline"
          >
            {labels.open}
          </Link>
        </li>
      ))}
    </ul>
  )
}
