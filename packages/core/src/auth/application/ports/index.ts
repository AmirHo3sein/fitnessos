import type { PersonId } from '@fitnessos/kernel'
import type { PhoneNumber } from '../../domain/PhoneNumber'

/**
 * Auth — ports.
 *
 * Note what is absent: there is no `getToken`, no `session` accessor, no token in any
 * return type. The access and refresh tokens live in httpOnly cookies set by the
 * server and are never readable from JavaScript. A token this layer could hand out is
 * a token an XSS payload can exfiltrate, so the safest surface is one that cannot
 * express it.
 *
 * What the client knows about the session is therefore only: a verification
 * succeeded, and which person it was for.
 */

export interface CodeRequested {
  /**
   * Server-authoritative. The client must not compute its own cooldown — two clients
   * disagreeing about when a retry is allowed produces either a button that does
   * nothing or a request that is rejected, and the server is the only party that
   * knows about attempts from other devices.
   */
  readonly retryAfterSeconds: number
  /** So the OTP input does not hardcode a length the server can change. */
  readonly codeLength: number
}

export interface SessionEstablished {
  readonly personId: PersonId
  /** Routes to onboarding rather than the dashboard. */
  readonly isNewPerson: boolean
}

export interface AuthPort {
  /**
   * Dispatch a one-time code.
   *
   * Resolves identically whether or not the phone is registered. A response that
   * differed would be an account-enumeration oracle: anyone could test a list of
   * numbers for membership. The contract enforces this on the server side; this
   * signature is where it is visible on the client side.
   */
  readonly requestCode: (phone: PhoneNumber, signal?: AbortSignal) => Promise<CodeRequested>

  readonly verifyCode: (
    phone: PhoneNumber,
    code: string,
    signal?: AbortSignal,
  ) => Promise<SessionEstablished>
}

export interface AuthPorts {
  readonly auth: AuthPort
}
