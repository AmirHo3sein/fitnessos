import { err, normalizeDigits, ok, type Result } from '@fitnessos/kernel'

/**
 * An Iranian mobile number in E.164 form.
 *
 * A value object rather than a validated string, because the interesting part is not
 * "is this valid" but "which of the six things the user might have typed is this, and
 * what is the one canonical form". Getting that wrong produces duplicate accounts:
 * `09123456789` and `+989123456789` are the same person, and a system that treats
 * them as different will cheerfully create two.
 *
 * Accepted inputs, all of which real users produce:
 *
 *   ۰۹۱۲۳۴۵۶۷۸۹        Persian digits from a Persian keyboard
 *   ٠٩١٢٣٤٥٦٧٨٩        Arabic-Indic digits
 *   0912 345 6789      spaces, as printed on a business card
 *   0912-345-6789      dashes
 *   +989123456789      E.164, from a contact export
 *   00989123456789     international prefix as dialled
 *   9123456789         no leading zero, as typed after a country selector
 *
 * All normalise to `+989123456789`.
 *
 * Deliberately NOT a general phone parser. This product's users are in Iran; a
 * library that handles 200 countries would accept numbers that cannot receive our SMS
 * and defer the failure to the dispatch step, where it becomes a support ticket
 * rather than a form error. Widening this is a one-line change to the pattern when
 * there is a second market.
 */

declare const brand: unique symbol
export type PhoneNumber = string & { readonly [brand]: 'PhoneNumber' }

export type PhoneError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'not-iranian-mobile'; readonly normalized: string }

/** `9` + operator code + subscriber, i.e. the national number without its zero. */
const NATIONAL = /^9[0-9]{9}$/

export const phoneNumber = (input: string): Result<PhoneNumber, PhoneError> => {
  // Persian and Arabic-Indic digits first: everything below assumes ASCII, and a
  // Persian keyboard is the most likely source of input in this market.
  const digitsOnly = normalizeDigits(input).replace(/[\s()‌.-]/g, '')

  if (digitsOnly === '') return err({ kind: 'empty' })

  // Reduce every accepted prefix to the national number, then check once. Checking
  // each prefix form separately is how one of them ends up subtly different.
  let national = digitsOnly
  if (national.startsWith('+98')) national = national.slice(3)
  else if (national.startsWith('0098')) national = national.slice(4)
  else if (national.startsWith('98') && national.length === 12) national = national.slice(2)
  else if (national.startsWith('0')) national = national.slice(1)

  if (!NATIONAL.test(national)) {
    return err({ kind: 'not-iranian-mobile', normalized: digitsOnly })
  }

  return ok(`+98${national}` as PhoneNumber)
}

/**
 * For display: `0912 345 6789`.
 *
 * Iranians read and dictate their own numbers in national form with a leading zero,
 * not in E.164. Showing `+989123456789` back to someone who typed `09123456789` reads
 * as "the system did not understand me".
 *
 * The result carries no direction marker. Render it inside the `nums` utility, which
 * forces LTR — a bare number in an RTL paragraph is reordered by the bidi algorithm
 * and displays with its groups reversed.
 */
export const formatPhoneNational = (phone: PhoneNumber): string => {
  const national = phone.slice(3)
  return `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`
}

/** Masked for confirmation screens: `0912 *** 6789`. */
export const maskPhone = (phone: PhoneNumber): string => {
  const national = phone.slice(3)
  return `0${national.slice(0, 3)} *** ${national.slice(6)}`
}
