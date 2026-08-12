import { describe, expect, it } from 'vitest'
import { subjectScope, UNSCOPED_KEY_ROOTS, type AthleteId } from '@fitnessos/kernel'
import { INVALIDATIONS, isKnownKind, keysFor, RESUME_IMPOSSIBLE } from '@fitnessos/infra'
import { athleteKeys } from '@fitnessos/core/athlete'
import { goalKeys } from '@fitnessos/core/goal'
import { learningKeys } from '@fitnessos/core/learning'
import { sessionKeys } from '@fitnessos/core/execution'
import { measurementKeys } from '@fitnessos/ctx-measurement'
import { programKeys } from '@fitnessos/ctx-prescription'
import { nutritionKeys } from '@fitnessos/ctx-nutrition'
import { workflowKeys } from '@fitnessos/ctx-workflow'
import { reportKeys } from '@fitnessos/ctx-report'
import { dashboardKeys } from '@fitnessos/ctx-dashboard'
import { timelineKeys } from '@fitnessos/ctx-timeline'

/**
 * The seam between the invalidation map and the real query keys.
 *
 * `infra` holds the map as plain strings because it may not import a context — the dependency runs
 * the other way. So the two sides agree by CONVENTION, and this test is the only thing that makes
 * the convention checkable. It lives in `composition` because only the app is allowed to see both.
 *
 * ## It was written because the map was already wrong
 *
 * Four of five segments were plausible names rather than actual ones: `programme` for `program`,
 * `sessions` for `session`, `indicators` for what is really `measurement`, `proposals` for
 * `learning`. Nothing failed. Every event would have invalidated a key nothing uses, and the only
 * symptom would have been screens that quietly do not update — the exact class of bug the handbook
 * calls the least diagnosable in a TanStack Query app, arriving through the mechanism built to
 * prevent it.
 */

/** A subject to build keys against. Any id will do — what is asserted is the SHAPE. */
const SUBJECT = '019000ff-0000-7000-8000-00000000fea7' as AthleteId

/**
 * Every subject-scoped key factory, called the way the app calls it.
 *
 * A function per factory rather than a pre-built array, so the test exercises the real call signature:
 * a factory that stopped requiring a subject would not compile here.
 */
const SCOPED_FACTORIES: readonly { readonly name: string; readonly key: readonly unknown[] }[] = [
  { name: 'athlete', key: athleteKeys.all(SUBJECT) },
  { name: 'goal', key: goalKeys.all(SUBJECT) },
  { name: 'learning', key: learningKeys.all(SUBJECT) },
  { name: 'session', key: sessionKeys.all(SUBJECT) },
  { name: 'measurement', key: measurementKeys.all(SUBJECT) },
  { name: 'program', key: programKeys.all(SUBJECT) },
  { name: 'nutrition', key: nutritionKeys.all(SUBJECT) },
  { name: 'workflow', key: workflowKeys.all(SUBJECT) },
  { name: 'report', key: reportKeys.all(SUBJECT) },
  { name: 'dashboard', key: dashboardKeys.all(SUBJECT) },
  { name: 'timeline', key: timelineKeys.all(SUBJECT) },
]

/** The roots the invalidation map may name — the segment after the subject prefix. */
const REAL_ROOTS: readonly string[] = [
  ...SCOPED_FACTORIES.map((f) => String(f.key[f.key.length - 1])),
  ...UNSCOPED_KEY_ROOTS,
]

describe('every invalidation targets a key that exists', () => {
  it('has no segment that matches nothing', () => {
    const unknown = Object.entries(INVALIDATIONS).flatMap(([kind, segments]) =>
      segments.filter((segment) => !REAL_ROOTS.includes(segment)).map((s) => `${kind} → ${s}`),
    )
    expect(unknown).toEqual([])
  })

  it('reads the roots from the factories, not from a copy of them', () => {
    // If this list were literals, it would drift in step with the map and agree with it forever.
    // Asserting a known root proves the imports are live.
    expect(REAL_ROOTS).toContain('program')
    expect(REAL_ROOTS).toContain('sync-issues')
  })
})

describe('resume-impossible is known, and answered differently', () => {
  /*
   * The server sends it when the position we resumed from has fallen out of its replay window
   * (BACKEND-CONTRACT §5.3). It must NOT be in the map — the entries there say "this thing changed",
   * and this one says "you have a gap and cannot know what changed", which is answered by invalidating
   * everything rather than by a key list.
   *
   * Asserted because the two properties pull against each other: adding it to `INVALIDATIONS` with a
   * plausible-looking key list would make `isKnownKind` pass and quietly replace a full invalidation
   * with a partial one. The gap would stay, and nothing would report it.
   */
  it('is recognised', () => {
    expect(isKnownKind(RESUME_IMPOSSIBLE)).toBe(true)
  })

  it('yields no key segments, because it is not an entity event', () => {
    expect(keysFor(RESUME_IMPOSSIBLE)).toEqual([])
    expect(Object.keys(INVALIDATIONS)).not.toContain(RESUME_IMPOSSIBLE)
  })
})

describe('no query key can be built without a subject', () => {
  /*
   * The guard this whole change exists for.
   *
   * Until a coach existed, `['program']` was unambiguous — one client could see one programme. The
   * moment a viewer can switch between athletes, that key is a CACHE COLLISION: TanStack Query serves
   * athlete A's programme for a read made while looking at athlete B. No error, no contract violation,
   * nothing in telemetry, and what the coach sees is one athlete's training under another's name.
   *
   * There is no runtime check that can catch that — by the time it happens the data looks fine. So the
   * check is here, on the shape of every key, before any coach route exists to trigger it.
   */
  it('puts the subject first in every scoped key', () => {
    const prefix = subjectScope(SUBJECT)
    const wrong = SCOPED_FACTORIES.filter(
      (f) => f.key[0] !== prefix[0] || f.key[1] !== prefix[1],
    ).map((f) => `${f.name} → ${JSON.stringify(f.key)}`)

    expect(wrong, 'every scoped key must begin with the subject prefix').toEqual([])
  })

  it('makes two subjects produce disjoint keys', () => {
    // The property that actually matters. Prefix-first is only useful if it separates.
    const other = '019000ff-0000-7000-8000-00000000beef' as AthleteId
    for (const factory of SCOPED_FACTORIES) {
      expect(JSON.stringify(factory.key)).not.toBe(
        JSON.stringify(subjectScope(other).concat(factory.key.slice(2) as never[])),
      )
    }
  })

  it('has exactly two deliberately unscoped roots, and says why in the kernel', () => {
    /*
     * `me` — "who is the authenticated person's athlete" (ADR-0005), asked BEFORE a subject exists and
     *   answered by the response that supplies one.
     * `sync-issues` — the offline queue is DEVICE-local; only an athlete logs their own sessions.
     *
     * Asserted as an exact list rather than a minimum, so a third exception is a decision somebody
     * makes on purpose instead of a shortcut that ships.
     */
    expect(UNSCOPED_KEY_ROOTS).toEqual(['me', 'sync-issues'])
    expect(athleteKeys.mine()[0]).toBe('me')
    expect(sessionKeys.syncIssues()[0]).toBe('sync-issues')
  })
})
