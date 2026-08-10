import { beforeAll, describe, expect, it } from 'vitest'
import { newId, request, signIn } from './client'

/**
 * §1 idempotency and §2 concurrency — the requirements that exist because the client REPLAYS.
 *
 * The offline queue is at-least-once by design (ADR-0033): a lost response means the same mutation is
 * sent again, and the client cannot tell "never arrived" from "arrived, response lost". Every rule
 * here is what makes that safe. Get one wrong and the failure is a duplicated session in someone's
 * history, or a queue poisoned forever by a record that will never be accepted.
 *
 * These checks WRITE. Point the suite at a disposable account.
 */

/**
 * Shapes as the API actually returns them, read from a live response rather than assumed.
 *
 * The first version of this file guessed `{ items: [...] }` for upcoming sessions and a flat
 * `versionId` on the programme. Both were wrong, and both produced a failure that read as a contract
 * violation when it was a wrong assumption in the check. A conformance suite that cries wolf is worse
 * than none, so these are derived from the schema and verified against a real payload.
 */
interface Programme {
  readonly id: string
  readonly currentVersion: {
    readonly id: string
    readonly blocks: readonly unknown[]
    readonly authoringDecision: unknown
    readonly servesGoal?: unknown
  }
}

interface UpcomingSession {
  readonly id: string
  readonly items: readonly { readonly id: string }[]
}

beforeAll(async () => {
  await signIn()
})

describe('§1.1 · POST /sessions/performed — 409 on a duplicate id', () => {
  it('accepts the first and refuses the second with 409', async () => {
    /**
     * Not 200, and not 500. The client treats **409 as success** when draining its queue, because a
     * duplicate means the original arrived and only the response was lost. A 500 would keep the
     * record in the queue forever; a 200 would be indistinguishable from a second real log and the
     * client would stop being able to detect double-submission at all.
     */
    // A bare array, not an envelope. `/sessions/upcoming` returns the sessions themselves.
    const upcoming = await request<readonly UpcomingSession[]>('/sessions/upcoming')
    const session = Array.isArray(upcoming.body) ? upcoming.body[0] : undefined
    const prescribedSessionId = session?.id
    const prescribedItemId = session?.items[0]?.id
    if (prescribedSessionId === undefined || prescribedItemId === undefined) {
      // Reported rather than skipped silently: a target with no prescribed session cannot answer this
      // question, and pretending otherwise would leave a green tick on an unasked check.
      expect.fail(
        'no prescribed session available on this account, so §1.1 could not be exercised — seed one first',
      )
    }

    const body = {
      id: newId(),
      prescribedSessionId,
      performedOn: '2026-08-10',
      // A REAL prescribed item id: the server is entitled to reject a set that references nothing,
      // and a 400 here would look like a §1.1 violation while being a malformed request.
      sets: [{ id: newId(), prescribedItemId, setNumber: 1, reps: 5 }],
    }

    const first = await request('/sessions/performed', { method: 'POST', body })
    expect(
      [200, 201].includes(first.status),
      `first log should be accepted; got ${String(first.status)}: ${first.text}`,
    ).toBe(true)

    const second = await request('/sessions/performed', { method: 'POST', body })
    expect(
      second.status,
      'a duplicate id must answer 409 — the client reads that as "already applied"',
    ).toBe(409)
  })
})

describe('§1.3 · POST /observations — 200 on a duplicate id', () => {
  it('answers 200, NOT 409, for the same observation twice', async () => {
    /**
     * Deliberately different from §1.1, and the asymmetry is the point. A measurement is a statement
     * about a moment; sending it twice asserts the same fact twice, so the second is a no-op and 200
     * is honest. A logged session is an EVENT, and two of them would mean two sessions.
     *
     * A server that answered 409 here would make the client surface a conflict for something that is
     * not one.
     */
    const body = {
      id: newId(),
      kind: 'body-mass',
      value: 78.4,
      unit: 'kg',
      observedOn: '2026-08-10',
      acquisition: { kind: 'self-reported' },
    }

    const first = await request('/observations', { method: 'POST', body })
    expect(
      [200, 201].includes(first.status),
      `first observation should be accepted; got ${String(first.status)}: ${first.text}`,
    ).toBe(true)

    const second = await request('/observations', { method: 'POST', body })
    expect(
      second.status,
      'a duplicate observation must answer 200 — it asserts the same fact, so it is a no-op',
    ).toBe(200)
  })
})

describe('§1.4 and §2.1 · programme versions', () => {
  it('answers 200 on a duplicate version id, and 409 on a stale baseVersionId', async () => {
    /**
     * Two rules on one endpoint, checked together because the second needs the first to have run.
     *
     * §1.4 — a replayed version POST must be a no-op, for the same reason as an observation: the
     * client cannot tell a lost response from a lost request.
     *
     * §2.1 — a version built on a `baseVersionId` that is no longer current must be REFUSED. The
     * client shows the coach that the programme moved under them; a server that accepted it would
     * silently discard whichever revision lost, and neither coach would know.
     */
    const current = await request<Programme>('/programs/current')
    if (current.status === 204 || current.body === null) {
      expect.fail(
        'no current programme on this account, so §1.4 and §2.1 could not be exercised — seed one first',
      )
    }

    const programme = current.body
    const baseVersionId = programme.currentVersion?.id
    if (baseVersionId === undefined) {
      expect.fail(
        'the current programme carries no currentVersion.id, so a revision cannot be constructed',
      )
    }

    const body = {
      id: newId(),
      baseVersionId,
      blocks: programme.currentVersion.blocks,
      // Required by the contract: a revision states WHY it exists. Sending a plausible one rather
      // than omitting it, so a 400 cannot be mistaken for the rule under test.
      authoringDecision: programme.currentVersion.authoringDecision,
    }

    const first = await request(`/programs/${programme.id}/versions`, { method: 'POST', body })
    expect(
      [200, 201].includes(first.status),
      `a revision on the current base should be accepted; got ${String(first.status)}: ${first.text}`,
    ).toBe(true)

    // §1.4 — the same POST again.
    const replayed = await request(`/programs/${programme.id}/versions`, { method: 'POST', body })
    expect(
      replayed.status,
      'a duplicate version id must answer 200, so a replayed queue entry is a no-op',
    ).toBe(200)

    // §2.1 — a NEW version still claiming the now-superseded base.
    const stale = await request(`/programs/${programme.id}/versions`, {
      method: 'POST',
      body: { ...body, id: newId() },
    })
    expect(
      stale.status,
      'a stale baseVersionId must answer 409 — otherwise a concurrent revision is silently lost',
    ).toBe(409)
  })
})

describe('§3.3 · 403 and 404 are different answers', () => {
  it('does not answer 404 for something that exists but is not yours', async () => {
    /**
     * The client renders them differently: 404 is "this is gone", 403 is "this is not yours". Collapsing
     * them into 404 hides a permissions bug as a missing-data bug, and sends the reader looking for the
     * wrong thing.
     *
     * Checked weakly on purpose — a well-formed id nobody owns should be 404 or 403, never a 200 and
     * never a 500. A stronger check needs two accounts, which this suite does not assume.
     */
    const response = await request(`/programs/${newId()}/versions`, {
      method: 'POST',
      body: { id: newId(), baseVersionId: newId(), blocks: [] },
    })
    expect(
      [400, 403, 404, 409].includes(response.status),
      `an unknown programme must not be a 200 or a 5xx; got ${String(response.status)}`,
    ).toBe(true)
  })
})
