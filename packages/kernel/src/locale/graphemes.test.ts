import { describe, expect, it } from 'vitest'
import { countGraphemes, truncateGraphemes } from './graphemes'

describe('countGraphemes', () => {
  it('counts ASCII as expected', () => {
    expect(countGraphemes('hello')).toBe(5)
  })

  it('counts an emoji as one, where .length says two', () => {
    expect('🏃'.length).toBe(2)
    expect(countGraphemes('🏃')).toBe(1)
  })

  it('counts a joined emoji sequence as one, where code points say five', () => {
    // The case that makes code-point counting a trap: it looks like the fix, and is not.
    expect(Array.from('👨‍👩‍👧').length).toBe(5)
    expect(countGraphemes('👨‍👩‍👧')).toBe(1)
  })

  it('counts a Persian letter with a diacritic as one', () => {
    // بَ — base letter plus fatha. Two code points, one perceived character. This is why
    // grapheme counting matters for this product specifically and not just for emoji.
    expect(Array.from('بَ').length).toBe(2)
    expect(countGraphemes('بَ')).toBe(1)
  })

  it('counts a zero-width non-joiner as part of its cluster, not a character', () => {
    // می‌روم reads as five characters to a Persian speaker; the ZWNJ is a joiner, not a
    // letter. It must not consume a character of the athlete's limit.
    expect(countGraphemes('می‌روم')).toBeLessThan(Array.from('می‌روم').length)
  })

  it('handles an empty string', () => {
    expect(countGraphemes('')).toBe(0)
  })
})

describe('truncateGraphemes', () => {
  it('truncates without splitting an emoji', () => {
    // Slicing by index would cut a surrogate pair in half, producing a lone surrogate
    // that renders as a replacement glyph.
    expect(truncateGraphemes('ab🏃cd', 3)).toBe('ab🏃')
  })

  it('does not sever a joined sequence', () => {
    expect(truncateGraphemes('a👨‍👩‍👧b', 2)).toBe('a👨‍👩‍👧')
  })

  it('returns the whole string when under the limit', () => {
    expect(truncateGraphemes('abc', 10)).toBe('abc')
  })

  it('returns empty for a non-positive limit', () => {
    expect(truncateGraphemes('abc', 0)).toBe('')
    expect(truncateGraphemes('abc', -1)).toBe('')
  })
})
