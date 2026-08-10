import { isErr, normalizeDigits } from '@fitnessos/kernel'
import { phoneNumber, type PhoneError, type PhoneNumber } from '../domain/PhoneNumber'
import type { AuthPorts, CodeRequested, SessionEstablished } from './ports/index'

/**
 * Auth — the sign-in use cases.
 *
 * These exist as application-layer functions rather than living inside the hook
 * because they are where the rules are, and rules belong somewhere testable without a
 * renderer (D-05). The hook composes; it does not decide.
 *
 * Each takes the RAW string the user typed. Parsing is part of the use case, not
 * something the caller is trusted to have done — a presentation layer that had to
 * remember to normalise first would eventually forget, on one of the several forms
 * that will accept a phone number.
 */

export type SignInError =
  | { readonly kind: 'invalid-phone'; readonly reason: PhoneError }
  | { readonly kind: 'invalid-code' }

/**
 * Thrown rather than returned, because these cross the boundary into TanStack Query,
 * where a rejected promise is how a mutation reports failure (handbook §2.2). Result
 * stays inside the domain.
 */
export class SignInValidationError extends Error {
  override readonly name = 'SignInValidationError'
  constructor(readonly problem: SignInError) {
    super(problem.kind)
  }
}

export const requestSignInCode = async (
  ports: AuthPorts,
  rawPhone: string,
  signal?: AbortSignal,
): Promise<{ phone: PhoneNumber; result: CodeRequested }> => {
  const parsed = phoneNumber(rawPhone)
  if (isErr(parsed)) {
    throw new SignInValidationError({ kind: 'invalid-phone', reason: parsed.error })
  }

  const result = await ports.auth.requestCode(parsed.value, signal)

  // The normalised number is returned alongside the result so the verify step uses
  // the same canonical value the request used. Re-parsing the user's raw input at
  // verify time would work today and break the moment the two inputs differ by a
  // space — which is exactly what happens when a code arrives and the user retypes.
  return { phone: parsed.value, result }
}

/**
 * The code as it should be sent: ASCII digits, nothing else.
 *
 * The same normalisation the phone number gets, and for the same reason — a Persian
 * keyboard produces ۱۲۳۴۵۶, and an SMS pasted from a notification often carries
 * surrounding whitespace. Omitting this here would produce the worst possible
 * failure: the user has typed the code that is on their screen, and the form says it
 * is wrong.
 */
export const normalizeCode = (code: string): string =>
  normalizeDigits(code).replace(/[\s‌-]/g, '')

/**
 * Digits only, at the length the SERVER declared. Never a hardcoded 6.
 *
 * `codeLength` reaches this from a response body, so it is interpolated into a
 * RegExp. That is safe only because the contract schema constrains it to an integer
 * in 4..8 and every response is validated before mapping (ADR-0031). If validation
 * were ever removed, this line would become an injection point — noted so the
 * dependency is visible rather than implied.
 */
export const isWellFormedCode = (code: string, codeLength: number): boolean =>
  new RegExp(`^[0-9]{${String(codeLength)}}$`).test(normalizeCode(code))

export const verifySignInCode = async (
  ports: AuthPorts,
  phone: PhoneNumber,
  code: string,
  codeLength: number,
  signal?: AbortSignal,
): Promise<SessionEstablished> => {
  const normalized = normalizeCode(code)
  if (!isWellFormedCode(normalized, codeLength)) {
    // Rejecting a malformed code locally is not security — the server checks it
    // regardless. It avoids spending one of a small number of server-side attempts on
    // input that cannot possibly be right, which would lock the user out of their own
    // sign-in for a typo.
    throw new SignInValidationError({ kind: 'invalid-code' })
  }

  return ports.auth.verifyCode(phone, normalized, signal)
}
