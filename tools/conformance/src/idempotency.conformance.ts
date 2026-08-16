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
    //
    // Indexed directly rather than through `Array.isArray`: that guard is typed `arg is any[]`, so
    // it discards the element type and every read below becomes an unchecked `any` — which is how a
    // suite whose whole job is checking shapes ends up not checking its own.
    const upcoming = await request<readonly UpcomingSession[]>('/sessions/upcoming')
    const session = upcoming.body?.[0]
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
    const baseVersionId = programme.currentVersion.id

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

describe('§2.1a · the other six artefacts refuse a save that did not read what it replaces', () => {
  it('answers 409 with the artefact as it now stands, and does not overwrite', async () => {
    /**
     * §2.1 was written for programme versions, because a programme was the only artefact two people
     * could plausibly edit when it was written. The other six were PUT with no precondition — safe
     * while there is exactly one author, and last-write-wins the moment there are two.
     *
     * ADR-0033 already rejected that resolution: neither available clock can decide which write is
     * last. So a coach and an athlete editing one nutrition plan would have had one silently overwrite
     * the other, with nothing recorded that it happened.
     *
     * Checked on `/plans` because it is the artefact with the least nested body — what is under test
     * is the precondition, and a validation failure would look like a violation while being a badly
     * built request.
     */
    /*
     * Reads BEFORE it writes, and that is not tidiness.
     *
     * The first version of this check assumed a fresh account and opened with a create. Against a
     * reused one — which is the normal case, since the suite is pointed at a disposable account rather
     * than a new one each run — the create answered 409 and the failure read as a violation of the
     * requirement rather than as the check making an assumption. Same trap as the stub's
     * seeded-programme phone.
     */
    const before = await request<{ id?: string; revision?: number }>('/plans/current')
    expect(
      [200, 204].includes(before.status),
      `could not read the current plan; got ${String(before.status)}: ${before.text}`,
    ).toBe(true)

    const id = before.body?.id ?? newId()
    const plan = {
      id,
      title: 'Conformance season',
      epoch: '2026-01-05',
      phases: [{ id: newId(), label: 'Base', start: 0, length: 28 }],
    }

    // Establish a known state: create if there is nothing, otherwise save onto what is there. A first
    // save carries no baseRevision, because there is nothing to collide with (§4.9 requires PUT to an
    // unknown id to create).
    const established = await request(`/plans/${id}`, {
      method: 'PUT',
      body:
        before.status === 204
          ? plan
          : { ...plan, baseRevision: before.body?.revision },
    })
    expect(
      established.status,
      `a save on the current revision should be accepted; got ${String(established.status)}: ${established.text}`,
    ).toBe(200)

    /*
     * A SECOND accepted save, so the revision is at least 2.
     *
     * Without it a fresh account sits at revision 1, and the stale case below would have to send
     * `baseRevision: 0` — which the schema refuses with 400 before the precondition is ever consulted.
     * The check would then report "expected 409, got 400" and read as a violation of §2.1a when it is
     * an invalid request. Found exactly that way.
     */
    const first = await request<{ revision?: number }>('/plans/current')
    await request(`/plans/${id}`, {
      method: 'PUT',
      body: { ...plan, baseRevision: first.body?.revision },
    })

    const stored = await request<{ revision?: number; title?: string }>('/plans/current')
    const revision = stored.body?.revision
    if (typeof revision !== 'number') {
      // Reported rather than skipped: without a revision on the read there is nothing for a client to
      // send back, and the requirement cannot be exercised at all.
      expect.fail(
        'GET /plans/current returned no `revision`, so §2.1a could not be exercised — the read must carry it',
      )
    }

    // The commonest collision, and the one a naive client produces by default: a save that never read.
    const blind = await request(`/plans/${id}`, {
      method: 'PUT',
      body: { ...plan, title: 'Written blind' },
    })
    expect(
      blind.status,
      'a save with no baseRevision against an existing artefact must answer 409, not overwrite',
    ).toBe(409)

    // …and one that read an older version.
    const stale = await request(`/plans/${id}`, {
      method: 'PUT',
      body: { ...plan, title: 'Written from stale', baseRevision: revision - 1 },
    })
    expect(stale.status, 'a stale baseRevision must answer 409').toBe(409)

    // Neither attempt changed anything. This is the assertion that actually matters — a 409 that
    // still wrote would be worse than no 409 at all.
    const now = await request<{ title?: string; revision?: number }>('/plans/current')
    expect(now.body?.title, 'a refused save must not have written').toBe('Conformance season')
    expect(now.body?.revision, 'a refused save must not move the revision').toBe(revision)

    // The correct base is accepted, and the revision moves on.
    const accepted = await request<{ revision?: number }>(`/plans/${id}`, {
      method: 'PUT',
      body: { ...plan, title: 'Written correctly', baseRevision: revision },
    })
    expect(accepted.status, 'the current baseRevision must be accepted').toBe(200)
  })
})
