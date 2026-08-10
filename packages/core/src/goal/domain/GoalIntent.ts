import { countGraphemes, err, ok, type Result } from '@fitnessos/kernel'

/**
 * What the athlete actually wants, in their own words.
 *
 * This is the psychological centre of the domain (ADR-0004). People do not wake up
 * wanting to improve a capability — they wake up wanting to run 10k without stopping,
 * or to carry their child upstairs without stopping. The system's job is to translate
 * that into something measurable, and it cannot do that if the original statement was
 * discarded at the door in favour of a dropdown.
 *
 * So the athlete's phrasing is preserved verbatim, and translation happens elsewhere.
 * Losing the phrasing is not recoverable: a coach reading "get stronger" cannot
 * reconstruct that the athlete said "stop feeling weak when I pick up my daughter".
 */

const brand = Symbol('GoalIntent')

export interface GoalIntent {
  readonly [brand]: true
  readonly text: string
}

export type GoalIntentError =
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-long'; readonly length: number; readonly max: number }

/**
 * A goal is a sentence, not an essay.
 *
 * The bound exists to keep this a *statement of intent* rather than a training diary —
 * something that fits in a card, a notification, and a coach's list. Longer content has
 * somewhere else to go once notes exist.
 */
export const MAX_INTENT_LENGTH = 200

export const goalIntent = (raw: string): Result<GoalIntent, GoalIntentError> => {
  /*
   * Collapse runs of whitespace, but do NOT touch the zero-width non-joiner (U+200C).
   *
   * This is the opposite of the right call for a phone number, where the ZWNJ is
   * incidental punctuation a Persian keyboard inserted and stripping it is correct.
   * In Persian *prose* the ZWNJ is a letter-level joiner that changes words:
   * می‌روم ("I go") is not میروم, and نمی‌دانم is not نمیدانم. Stripping it here would
   * silently corrupt the athlete's own sentence — and to a Persian reader the result
   * looks like a spelling error the product introduced.
   *
   * `\s` in JavaScript does not match U+200C, so the ZWNJ survives this by default.
   * The comment exists because the next person to touch this will have just read the
   * phone-number code, where the rule is reversed.
   */
  const text = raw.replace(/\s+/g, ' ').trim()

  if (text === '') return err({ kind: 'empty' })

  // Counted in GRAPHEMES — characters as a person counts them.
  //
  // `.length` counts UTF-16 units, so an emoji is 2. Counting code points fixes emoji
  // and still miscounts vocalised Persian: بَ is one perceived
  // character and two code points. Either would tell the athlete they had used more of
  // the limit than they had, with nothing on screen explaining why.
  const length = countGraphemes(text)
  if (length > MAX_INTENT_LENGTH) {
    return err({ kind: 'too-long', length, max: MAX_INTENT_LENGTH })
  }

  return ok({ [brand]: true, text })
}

export const intentText = (intent: GoalIntent): string => intent.text
