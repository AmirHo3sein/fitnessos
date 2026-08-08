/**
 * Counting characters the way a person counts them.
 *
 * Three units get confused, and only the third is what a user means by "characters":
 *
 *   `str.length`      UTF-16 code units. `'🏃'.length` is 2.
 *   `[...str].length`  code points. `'🏃'` is 1, but `'👨‍👩‍👧'` is 5 and a Persian
 *                      letter carrying a diacritic is 2.
 *   graphemes          what is rendered as one thing, which is what this counts.
 *
 * The middle one is a trap because it looks correct. It fixes the obvious emoji case and
 * then still miscounts Persian text with harakat — بَ is one perceived character and two
 * code points — so an athlete writing vocalised Persian would be told they had used more
 * of a limit than they had, with no way to see why.
 *
 * `Intl.Segmenter` is the only correct answer available without a dependency, and it is
 * in every runtime this product targets.
 */

/**
 * Constructed once. `Intl.Segmenter` is expensive to build relative to using it, and this
 * runs on every keystroke behind a character counter.
 *
 * Locale is irrelevant for grapheme segmentation — the algorithm is defined over Unicode
 * properties, not language — so `'en'` here is not an English assumption. Passing the
 * user's locale would imply otherwise and invite someone to thread it through.
 */
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

/** Characters as a person would count them. */
export const countGraphemes = (text: string): number =>
  // `Array.from` over the segment iterator, not a spread of the string itself — spreading
  // a string is what this function exists to avoid, and the lint rule that forbids it is
  // right for exactly the reasons in the note above.
  Array.from(segmenter.segment(text)).length

/**
 * Truncate to a grapheme count without splitting a character.
 *
 * Slicing by index can cut a surrogate pair in half, producing a lone surrogate that
 * renders as a replacement glyph — or sever a joiner sequence, turning one emoji into
 * two unrelated ones.
 */
export const truncateGraphemes = (text: string, max: number): string => {
  if (max <= 0) return ''
  let out = ''
  let count = 0
  for (const { segment } of segmenter.segment(text)) {
    if (count >= max) break
    out += segment
    count += 1
  }
  return out
}
