/**
 * Digit normalisation.
 *
 * A Persian keyboard produces Persian digits — ۰۱۲۳۴۵۶۷۸۹, U+06F0..U+06F9 — and an
 * Arabic one produces Arabic-Indic digits — ٠١٢٣٤٥٦٧٨٩, U+0660..U+0669. Neither is
 * an ASCII digit. `Number('۰۹۱۲')` is `NaN`, `/^\d+$/` does not match, and
 * `parseInt` returns `NaN`.
 *
 * So every numeric field a Persian-speaking user types into needs this before it is
 * parsed, validated or compared. Skipping it produces the most confusing possible
 * failure: the user has typed a phone number that looks correct on screen, and the
 * form says it is invalid.
 *
 * This lives in the kernel rather than in a form helper because it is not a
 * presentation concern — a phone number parsed from an SMS webhook or a CSV import
 * needs exactly the same treatment, and a rule applied in only one of three entry
 * points is not a rule.
 */

const PERSIAN_ZERO = 0x06f0
const ARABIC_INDIC_ZERO = 0x0660

/**
 * Replace Persian and Arabic-Indic digits with their ASCII equivalents. Every other
 * character is left exactly as it was.
 *
 * Note what is deliberately NOT done here: no trimming, no stripping of separators,
 * no locale-specific decimal handling. This does one thing, so it can be applied
 * anywhere without a caller having to reason about what else it might have changed.
 */
export const normalizeDigits = (input: string): string => {
  let out = ''
  for (const char of input) {
    const code = char.codePointAt(0)
    if (code === undefined) continue

    if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO)
    } else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO)
    } else {
      out += char
    }
  }
  return out
}

/** True when every character is an ASCII digit, after normalisation. */
export const isAllDigits = (input: string): boolean => /^[0-9]+$/.test(normalizeDigits(input))
