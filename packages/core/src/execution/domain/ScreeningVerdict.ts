/**
 * Whether a resolved dose is safe for this athlete to attempt.
 *
 * ADR-0014: `MovementRestriction` is a published screening view — an **ungated verdict** plus
 * a **consent-gated basis**. That shape is why this type has a `basis` that may legitimately
 * be absent: the verdict itself is always readable, but the reason behind it is health data
 * under ADR-0002 and requires consent that a given viewer may not have.
 *
 * So `basis: null` does not mean "no reason". It means "you are not authorised to see the
 * reason", and the UI must say that rather than implying the restriction is unexplained. The
 * two read identically in a nullable field and are completely different statements to an
 * athlete looking at why their session was capped.
 */

export type VerdictLevel = 'clear' | 'modified' | 'blocked'

export interface ScreeningVerdict {
  readonly level: VerdictLevel
  /**
   * Why, when the viewer is entitled to know. Null when consent-gated (ADR-0002/0014), NOT
   * when absent — see the file note.
   */
  readonly basis: string | null
  /** True when a basis exists but this viewer may not see it. Distinguishes the two nulls. */
  readonly basisWithheld: boolean
}

export const isAttemptable = (verdict: ScreeningVerdict): boolean => verdict.level !== 'blocked'
