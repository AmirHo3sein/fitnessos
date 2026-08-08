import { isErr, isOk, unwrapOrThrow } from '@fitnessos/kernel'
import { describe, expect, it } from 'vitest'
import { formatPhoneNational, maskPhone, phoneNumber, type PhoneNumber } from './PhoneNumber'

const parse = (input: string): PhoneNumber =>
  unwrapOrThrow(phoneNumber(input), (e) => new Error(JSON.stringify(e)))

describe('phoneNumber', () => {
  /**
   * The central property. Every form a real user produces must reduce to ONE value —
   * otherwise `09123456789` and `+989123456789` become two accounts for one person,
   * and the duplicate is only discovered when they cannot see their own history.
   */
  it.each([
    ['۰۹۱۲۳۴۵۶۷۸۹', 'Persian digits'],
    ['٠٩١٢٣٤٥٦٧٨٩', 'Arabic-Indic digits'],
    ['09123456789', 'national with leading zero'],
    ['0912 345 6789', 'spaces'],
    ['0912-345-6789', 'dashes'],
    ['+989123456789', 'E.164'],
    ['00989123456789', 'international dialling prefix'],
    ['989123456789', 'country code, no plus'],
    ['9123456789', 'no leading zero'],
    ['۰۹۱۲ ۳۴۵-۶۷۸۹', 'Persian digits with mixed separators'],
    ['(0912) 345 6789', 'parenthesised operator code'],
  ])('normalises %s (%s) to +989123456789', (input) => {
    expect(parse(input)).toBe('+989123456789')
  })

  it('normalises a zero-width non-joiner, which Persian keyboards insert', () => {
    // U+200C appears in Persian text far more than anywhere else and survives copy
    // and paste. Left in, it makes an otherwise correct number fail validation.
    expect(parse('0912‌3456789')).toBe('+989123456789')
  })

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['0212345678', 'landline, not mobile'],
    ['091234567', 'too short'],
    ['091234567890', 'too long'],
    ['+447911123456', 'a valid number in another country'],
    ['0912345678a', 'contains a letter'],
    ['۰۸۱۲۳۴۵۶۷۸۹', 'starts 08, not a mobile prefix'],
  ])('rejects %s (%s)', (input) => {
    expect(isErr(phoneNumber(input))).toBe(true)
  })

  it('distinguishes empty from malformed, because the messages differ', () => {
    // "Enter your number" and "That does not look like an Iranian mobile" are
    // different instructions, and a single error kind would collapse them.
    const empty = phoneNumber('')
    const malformed = phoneNumber('0212345678')
    expect(isErr(empty) && empty.error.kind).toBe('empty')
    expect(isErr(malformed) && malformed.error.kind).toBe('not-iranian-mobile')
  })

  it('reports what it normalised to, so an error message can echo it back', () => {
    const result = phoneNumber('۰۲۱۲۳۴۵۶۷۸')
    expect(isErr(result) && result.error.kind === 'not-iranian-mobile' && result.error.normalized)
      .toBe('0212345678')
  })

  it('is idempotent — parsing its own output yields the same value', () => {
    // Matters because a normalised number is stored, read back, and re-parsed on the
    // way through a form. A parser that is not idempotent corrupts on the second pass.
    const once = parse('09123456789')
    expect(parse(once)).toBe(once)
  })

  it('returns Result rather than throwing, since invalid input is expected here', () => {
    expect(isOk(phoneNumber('09123456789'))).toBe(true)
    expect(isOk(phoneNumber('nonsense'))).toBe(false)
  })
})

describe('display forms', () => {
  it('formats nationally, which is how Iranians read their own number', () => {
    // Echoing +989123456789 back at someone who typed 09123456789 reads as
    // "the system did not understand me".
    expect(formatPhoneNational(parse('09123456789'))).toBe('0912 345 6789')
  })

  it('masks the middle for confirmation screens', () => {
    expect(maskPhone(parse('09123456789'))).toBe('0912 *** 6789')
  })

  it('leaves enough of the number to be recognisable', () => {
    // A mask that hides everything cannot answer the question it exists to answer:
    // "is this the phone you have in your hand?"
    const masked = maskPhone(parse('09123456789'))
    expect(masked).toContain('0912')
    expect(masked).toContain('6789')
    expect(masked).not.toContain('345')
  })
})
