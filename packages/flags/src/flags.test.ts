import { describe, expect, it } from 'vitest'
import { FLAGS, FLAG_NAMES, defaultFlags, envVarFor, fixedFlags, flagsFromEnv } from './index'

describe('the vocabulary', () => {
  it('names every flag it defines', () => {
    expect(FLAG_NAMES).toEqual(Object.keys(FLAGS))
    expect(FLAG_NAMES.length).toBeGreaterThan(0)
  })

  it('gives every flag a removal condition', () => {
    /**
     * A flag nobody plans to remove is a permanent branch in the product, and two branches means
     * every path is exercised half as often. Asserted rather than requested in a review comment,
     * because a review comment is not a gate.
     */
    for (const [name, definition] of Object.entries(FLAGS)) {
      expect(definition.removeWhen, name).not.toBe('')
      expect(definition.disables, name).not.toBe('')
    }
  })
})

describe('reading flags from the environment', () => {
  it('maps a name to an env var somebody could type from memory', () => {
    expect(envVarFor('live-invalidation')).toBe('FLAG_LIVE_INVALIDATION')
  })

  it('honours an explicit off', () => {
    for (const value of ['off', 'OFF', 'false', '0', ' off ']) {
      expect(flagsFromEnv({ FLAG_LIVE_INVALIDATION: value }).isEnabled('live-invalidation'), value)
        .toBe(false)
    }
  })

  it('honours an explicit on', () => {
    for (const value of ['on', 'TRUE', '1']) {
      expect(flagsFromEnv({ FLAG_LIVE_INVALIDATION: value }).isEnabled('live-invalidation'), value)
        .toBe(true)
    }
  })

  it('falls back to the DECLARED default for anything it does not recognise', () => {
    /**
     * The load-bearing test, and the opposite of the usual `Boolean(value)` reflex.
     *
     * A kill switch defaults ON. If an unrecognised value counted as false, then `FLAG_X=disabled`,
     * `FLAG_X=no`, an empty string, or a typo would each silently withdraw a shipped feature — and
     * nothing would report that the value was never understood. Unrecognised means "nobody has
     * decided", and the declared fallback is what somebody already decided.
     */
    for (const value of ['', '   ', 'disabled', 'no', 'yes', 'maybe', 'ON!', 'nul']) {
      expect(flagsFromEnv({ FLAG_LIVE_INVALIDATION: value }).isEnabled('live-invalidation'), value)
        .toBe(FLAGS['live-invalidation'].fallback)
    }
  })

  it('falls back when the variable is absent entirely', () => {
    expect(flagsFromEnv({}).isEnabled('live-invalidation')).toBe(
      FLAGS['live-invalidation'].fallback,
    )
  })

  it('ignores a similarly-named variable', () => {
    // `NEXT_PUBLIC_` is deliberately not read: a public var is inlined at BUILD time, which would
    // make a flag a property of the build rather than of the deployment — and a kill switch that
    // needs a rebuild is not a kill switch.
    expect(
      flagsFromEnv({ NEXT_PUBLIC_FLAG_LIVE_INVALIDATION: 'off' }).isEnabled('live-invalidation'),
    ).toBe(true)
  })
})

describe('the fixed and default ports', () => {
  it('defaultFlags returns each declared fallback', () => {
    for (const name of FLAG_NAMES) {
      expect(defaultFlags.isEnabled(name), name).toBe(FLAGS[name].fallback)
    }
  })

  it('fixedFlags leaves unspecified flags at their fallback', () => {
    // A test that meant to override one flag must not silently disable every other one — which is
    // what a plain `Record` lookup returning `undefined` would do.
    const flags = fixedFlags({})
    for (const name of FLAG_NAMES) {
      expect(flags.isEnabled(name), name).toBe(FLAGS[name].fallback)
    }
  })

  it('fixedFlags overrides what it is given', () => {
    expect(fixedFlags({ 'live-invalidation': false }).isEnabled('live-invalidation')).toBe(false)
  })
})
