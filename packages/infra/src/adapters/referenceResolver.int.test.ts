import type { GoalReadPort, GoalSnapshot } from '@fitnessos/core/goal'
import type { DocumentRef } from '@fitnessos/editor-engine'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http/errors'
import { createReferenceResolver } from './referenceResolver'

const goal = (id: string, intent: string): GoalSnapshot =>
  ({
    id,
    athleteId: 'a1',
    intent,
    declaredOn: { year: 2026, month: 1, day: 1 },
    horizon: null,
    cadenceDays: 28,
  }) as unknown as GoalSnapshot

const ref = (id: string, kind: DocumentRef['kind'] = 'goal'): DocumentRef => ({
  kind,
  id,
  fallbackLabel: 'fallback',
})

const resolver = (listMine: GoalReadPort['listMine']) =>
  createReferenceResolver({ goal: { listMine }, hrefFor: (_k, id) => `/goals/${id}` })

describe('resolving', () => {
  it('returns the goal’s own words as the label', async () => {
    const r = resolver(() => Promise.resolve([goal('g1', 'Run 10k without stopping')]))
    const out = await r.resolve([ref('g1')])

    expect(out.get('goal:g1')).toEqual({
      state: 'resolved',
      label: 'Run 10k without stopping',
      href: '/goals/g1',
    })
  })

  it('makes ONE call for many references to the same target', async () => {
    // A resolver call is a network request. A programme with the same goal on twelve blocks must
    // ask once — the reason `resolve` takes an array at all.
    const listMine = vi.fn(() => Promise.resolve([goal('g1', 'Run 10k')]))
    await resolver(listMine).resolve([ref('g1'), ref('g1'), ref('g1')])
    expect(listMine).toHaveBeenCalledOnce()
  })

  it('makes no call at all for an empty document', async () => {
    const listMine = vi.fn(() => Promise.resolve([]))
    const out = await resolver(listMine).resolve([])
    expect(listMine).not.toHaveBeenCalled()
    expect(out.size).toBe(0)
  })
})

describe('broken is a state, not a failure', () => {
  it('a goal absent from the list is broken, not thrown', async () => {
    // The guarantee the whole design rests on: an editor that failed to open because a goal was
    // tidied up would have lost a coach's programme to someone else's cleanup.
    const r = resolver(() => Promise.resolve([goal('other', 'Something else')]))
    const out = await r.resolve([ref('g1')])
    expect(out.get('goal:g1')).toEqual({ state: 'broken', reason: 'deleted' })
  })

  it('a 403 is forbidden, not deleted', async () => {
    // Different facts. "It was removed" and "you may not see it" must not be collapsed
    // (ADR-0002 / ADR-0014).
    const r = resolver(() => Promise.reject(new ApiError(403, 'forbidden', 'nope')))
    const out = await r.resolve([ref('g1')])
    expect(out.get('goal:g1')).toEqual({ state: 'broken', reason: 'forbidden' })
  })

  it('a server failure still yields a renderable map rather than rejecting', async () => {
    const r = resolver(() => Promise.reject(new ApiError(500, null, 'boom')))
    await expect(r.resolve([ref('g1')])).resolves.toBeInstanceOf(Map)
  })

  it('a kind with no resolver yet is broken rather than left pending', async () => {
    // Omitting it from the map would leave the chip loading forever, which reads as a hung
    // editor. Broken plus the fallback label is honest and renders something.
    const r = resolver(() => Promise.resolve([]))
    const out = await r.resolve([ref('m1', 'movement')])
    expect(out.get('movement:m1')).toEqual({ state: 'broken', reason: 'deleted' })
  })

  it('does not conflate the same id across kinds', async () => {
    const r = resolver(() => Promise.resolve([goal('x', 'Run 10k')]))
    const out = await r.resolve([ref('x', 'goal'), ref('x', 'movement')])

    expect(out.get('goal:x')).toMatchObject({ state: 'resolved' })
    expect(out.get('movement:x')).toMatchObject({ state: 'broken' })
  })
})

describe('cancellation', () => {
  it('an aborted request rethrows instead of marking everything broken', async () => {
    // A navigation is not a broken reference. Swallowing the abort would flash warning chips
    // across the editor on the way out of the page.
    const controller = new AbortController()
    controller.abort()

    const r = resolver(() => Promise.reject(new DOMException('aborted', 'AbortError')))
    await expect(r.resolve([ref('g1')], controller.signal)).rejects.toThrow()
  })
})
