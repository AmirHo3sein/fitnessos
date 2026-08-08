/**
 * Single-flight session refresh.
 *
 * This exists because of two facts that combine badly:
 *
 *   1. V1 implemented POST /auth/refresh and never called it, so sessions died
 *      after 15 minutes. Wiring it up is the highest-value fix in the product.
 *
 *   2. The endpoint performs STRICT ROTATION — it revokes the token presented to
 *      it. So N concurrent 401s each triggering a refresh would each rotate, and
 *      every rotation but the last would revoke a session that had just been
 *      issued. The user gets logged out at random, under load, intermittently.
 *
 * The fix is to serialise: the first caller starts a refresh, everyone else awaits
 * the same promise. That single shared promise is the whole point of this module,
 * and `refresh.test.ts` asserts the invariant directly by counting network calls.
 */

export interface RefreshConfig {
  /** Performs the rotation. Resolves on success, rejects on failure. */
  readonly rotate: () => Promise<void>
  /** Called when rotation fails — clear caches, redirect to login. */
  readonly onSessionLost?: () => void
}

export interface Refresher {
  /** Refresh, joining any attempt already in flight. */
  readonly refresh: () => Promise<void>
  /** Testing/diagnostics: how many rotations have actually been performed. */
  readonly rotationCount: () => number
}

export const createRefresher = (config: RefreshConfig): Refresher => {
  let inFlight: Promise<void> | null = null
  let rotations = 0

  const refresh = (): Promise<void> => {
    // Late joiners attach to the existing attempt rather than starting another.
    inFlight ??= (async () => {
      rotations += 1
      try {
        await config.rotate()
      } catch (error) {
        config.onSessionLost?.()
        throw error
      } finally {
        // Cleared in `finally` so a failed refresh does not wedge every
        // subsequent request behind a permanently rejected promise.
        inFlight = null
      }
    })()

    return inFlight
  }

  return { refresh, rotationCount: () => rotations }
}
