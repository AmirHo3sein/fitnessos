import { describe, expect, it } from 'vitest'
import { INVALIDATIONS } from '@fitnessos/infra'
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

/** Every key root the app actually uses, from the factories that own them. */
const REAL_ROOTS: readonly string[] = [
  athleteKeys.all[0],
  goalKeys.all[0],
  learningKeys.all[0],
  sessionKeys.all[0],
  sessionKeys.syncIssues()[0],
  measurementKeys.all[0],
  programKeys.all[0],
  nutritionKeys.all[0],
  workflowKeys.all[0],
  reportKeys.all[0],
  dashboardKeys.all[0],
  timelineKeys.all[0],
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
