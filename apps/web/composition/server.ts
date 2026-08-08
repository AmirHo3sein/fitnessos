import { cookies } from 'next/headers'
import { createContainer, type Container } from './container'

/**
 * The server-side container, built from the incoming request's cookies.
 *
 * Server `fetch` carries no ambient session, so the cookie has to be forwarded
 * explicitly. `cookies()` is request-scoped in Next's async context, which is
 * what makes a per-request container correct here rather than merely tidy.
 *
 * `INTERNAL_API_URL` exists because ADR-0025's same-origin arrangement is a
 * property of the reverse proxy, which the server sits behind rather than in
 * front of. Falling back to a localhost default would be worse than failing:
 * a misconfigured production deployment would quietly serve empty pages instead
 * of refusing to start.
 */
const internalApiUrl = (): string => {
  const url = process.env['INTERNAL_API_URL']
  if (!url) {
    throw new Error(
      'INTERNAL_API_URL is not set. The server cannot reach the API through the ' +
        'public reverse proxy (ADR-0025), so it needs the internal address ' +
        'explicitly. There is deliberately no default.',
    )
  }
  return url
}

export const createServerContainer = async (): Promise<Container> => {
  const jar = await cookies()
  const cookie = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ')

  return createContainer({
    mode: 'server',
    baseUrl: internalApiUrl(),
    // Omit rather than pass an empty string: `exactOptionalPropertyTypes` makes
    // the distinction meaningful, and an empty Cookie header is not the same as
    // no Cookie header to some proxies.
    ...(cookie ? { auth: { cookie } } : {}),
  })
}
