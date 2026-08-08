import { describe, expect, it } from 'vitest'
import { isAllDigits, normalizeDigits } from './digits'

describe('normalizeDigits', () => {
  it('converts Persian digits', () => {
    expect(normalizeDigits('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789')
  })

  it('converts Arabic-Indic digits', () => {
    expect(normalizeDigits('٠٩١٢٣٤٥٦٧٨٩')).toBe('09123456789')
  })

  it('handles a mix, which is what a real keyboard actually produces', () => {
    // Users switch layouts mid-entry, or paste half a number from elsewhere.
    expect(normalizeDigits('۰۹12٣٤56789')).toBe('09123456789')
  })

  it('leaves ASCII digits alone', () => {
    expect(normalizeDigits('09123456789')).toBe('09123456789')
  })

  it('leaves non-digit characters exactly as they were', () => {
    // Including the separators a user types and the + of an international prefix.
    expect(normalizeDigits('+۹۸ ۹۱۲-۳۴۵ ۶۷۸۹')).toBe('+98 912-345 6789')
  })

  it('leaves Persian letters alone', () => {
    // The letter ی (U+06CC) sits near the Persian digit block; an off-by-one in the
    // range check would corrupt ordinary Persian text.
    expect(normalizeDigits('سلام ۱۲۳')).toBe('سلام 123')
  })

  it('does not trim or strip — it does exactly one thing', () => {
    expect(normalizeDigits('  ۱۲۳  ')).toBe('  123  ')
  })

  it('handles an empty string', () => {
    expect(normalizeDigits('')).toBe('')
  })

  it('preserves characters outside the BMP rather than splitting them', () => {
    // Iterating by code unit rather than code point would split a surrogate pair and
    // corrupt the emoji. `for…of` iterates code points.
    expect(normalizeDigits('۱۲۳🏋️‍♀️')).toBe('123🏋️‍♀️')
  })
})

describe('isAllDigits', () => {
  it('accepts Persian digits', () => {
    expect(isAllDigits('۰۹۱۲')).toBe(true)
  })

  it('rejects a string with a separator', () => {
    expect(isAllDigits('۰۹۱۲-۳۴۵')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isAllDigits('')).toBe(false)
  })
})
