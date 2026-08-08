/**
 * Result — the error model for domain and editor-engine code.
 *
 * Handbook §2.2: Result is used inside domain and editor-engine, where invariant
 * violations are expected control flow. At the infrastructure boundary we throw,
 * so that TanStack Query and React error boundaries work with the grain rather
 * than against it. Do not propagate Result into presentation.
 */

export type Ok<T> = { readonly ok: true; readonly value: T }
export type Err<E> = { readonly ok: false; readonly error: E }
export type Result<T, E> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok

export const map = <T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> =>
  r.ok ? ok(f(r.value)) : r

export const mapErr = <T, E, F>(r: Result<T, E>, f: (e: E) => F): Result<T, F> =>
  r.ok ? r : err(f(r.error))

export const andThen = <T, U, E>(
  r: Result<T, E>,
  f: (v: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r)

export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.ok ? r.value : fallback

/** Collect a list of Results into a Result of list, failing on the first error. */
export const all = <T, E>(results: readonly Result<T, E>[]): Result<T[], E> => {
  const values: T[] = []
  for (const r of results) {
    if (!r.ok) return r
    values.push(r.value)
  }
  return ok(values)
}

/**
 * Cross the boundary into presentation. Throws on Err.
 * The only sanctioned place to leave the Result world.
 */
export const unwrapOrThrow = <T, E>(r: Result<T, E>, toError: (e: E) => Error): T => {
  if (r.ok) return r.value
  throw toError(r.error)
}
