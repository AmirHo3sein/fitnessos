import { isErr, isOk, unwrapOrThrow } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { MAX_INTENT_LENGTH, goalIntent, intentText } from './GoalIntent'

const text = (raw: string): string =>
  intentText(unwrapOrThrow(goalIntent(raw), (e) => new Error(JSON.stringify(e))))

describe('goalIntent', () => {
  it("preserves the athlete's own phrasing", () => {
    // The whole point. A coach reading "get stronger" cannot reconstruct that the
    // athlete said "stop feeling weak when I pick up my daughter".
    const raw = 'stop feeling weak when I pick up my daughter'
    expect(text(raw)).toBe(raw)
  })

  it('collapses whitespace runs and trims', () => {
    expect(text('  run   10k    without stopping  ')).toBe('run 10k without stopping')
  })

  it('rejects empty and whitespace-only input', () => {
    expect(isErr(goalIntent(''))).toBe(true)
    expect(isErr(goalIntent('    '))).toBe(true)
  })

  it('PRESERVES the zero-width non-joiner in Persian prose', () => {
    // The opposite of the correct call for a phone number, where the ZWNJ is incidental
    // punctuation a Persian keyboard inserted. In prose it is a letter-level joiner that
    // changes words: می‌روم ("I go") is not میروم. Stripping it would silently corrupt
    // the athlete's sentence, and to a Persian reader the result reads as a spelling
    // error the product introduced.
    const raw = 'می‌خواهم ۱۰ کیلومتر بدون توقف بدوم'
    expect(text(raw)).toBe(raw)
    expect(text(raw)).toContain('‌')
  })

  it('does not normalise Persian digits, because this is prose not a number', () => {
    // ۱۰ inside a sentence is how a Persian speaker writes it. Converting to 10 would
    // edit their words.
    expect(text('۱۰ کیلومتر')).toBe('۱۰ کیلومتر')
  })

  it('accepts exactly the length limit', () => {
    expect(isOk(goalIntent('a'.repeat(MAX_INTENT_LENGTH)))).toBe(true)
  })

  it('rejects one over, reporting both numbers', () => {
    const result = goalIntent('a'.repeat(MAX_INTENT_LENGTH + 1))
    expect(isErr(result) && result.error).toEqual({
      kind: 'too-long',
      length: MAX_INTENT_LENGTH + 1,
      max: MAX_INTENT_LENGTH,
    })
  })

  it('counts graphemes, not UTF-16 units', () => {
    // `.length` counts a surrogate pair as two, so an athlete whose goal ends in 🏃 would
    // be told they are over a limit they are not over.
    const withEmoji = `${'a'.repeat(MAX_INTENT_LENGTH - 1)}🏃`
    expect(withEmoji.length).toBe(MAX_INTENT_LENGTH + 1)
    expect(isOk(goalIntent(withEmoji))).toBe(true)
  })

  it('counts a joined emoji sequence as one character', () => {
    // Code-point counting would call this five, which is the trap that looks correct: it
    // fixes the simple emoji case and still miscounts anything joined.
    const family = `${'a'.repeat(MAX_INTENT_LENGTH - 1)}👨‍👩‍👧`
    expect(isOk(goalIntent(family))).toBe(true)
  })

  it('counts a Persian letter with a diacritic as one character', () => {
    // بَ is one perceived character and two code points. Vocalised Persian is exactly the
    // case a code-point count gets wrong, and the athlete would have no way to see why.
    const vocalised = `${'ا'.repeat(MAX_INTENT_LENGTH - 1)}بَ`
    expect(isOk(goalIntent(vocalised))).toBe(true)
  })
})
