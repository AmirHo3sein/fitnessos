import { describe, expect, it } from 'vitest'
import { all, andThen, err, isErr, isOk, map, mapErr, ok, unwrapOr, unwrapOrThrow } from './index'

describe('Result', () => {
  it('narrows with the guards', () => {
    const good = ok(1)
    const bad = err('boom')
    expect(isOk(good)).toBe(true)
    expect(isErr(bad)).toBe(true)
  })

  it('maps values and leaves errors untouched', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6))
    expect(map(err<string>('boom'), (n: number) => n * 3)).toEqual(err('boom'))
  })

  it('maps errors and leaves values untouched', () => {
    expect(mapErr(err('boom'), (e) => `${e}!`)).toEqual(err('boom!'))
    expect(mapErr(ok(1), (e: string) => `${e}!`)).toEqual(ok(1))
  })

  it('chains with andThen, short-circuiting on the first error', () => {
    const parse = (s: string) =>
      Number.isNaN(Number(s)) ? err(`not a number: ${s}`) : ok(Number(s))
    expect(andThen(ok('42'), parse)).toEqual(ok(42))
    expect(andThen(ok('abc'), parse)).toEqual(err('not a number: abc'))
  })

  it('collects with all, failing on the first error', () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]))
    expect(all([ok(1), err('bad'), err('worse')])).toEqual(err('bad'))
  })

  it('falls back with unwrapOr', () => {
    expect(unwrapOr(ok(1), 99)).toBe(1)
    expect(unwrapOr(err('boom'), 99)).toBe(99)
  })

  it('throws only at the sanctioned boundary', () => {
    expect(unwrapOrThrow(ok(1), () => new Error('unreachable'))).toBe(1)
    expect(() => unwrapOrThrow(err('boom'), (e) => new Error(e))).toThrow('boom')
  })
})
