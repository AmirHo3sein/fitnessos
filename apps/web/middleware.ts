import createIntlMiddleware from 'next-intl/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { routing } from './src/i18n/routing'
import { buildCsp, newNonce } from './src/security/csp'

const intl = createIntlMiddleware(routing)

/** Route segments under `(app)` require a session. */
const PROTECTED = ['/dashboard', '/onboarding', '/programme', '/sessions', '/check-in', '/report', '/layout', '/settings']

const stripLocale = (pathname: string): string => {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/'
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1)
  }
  return pathname
}

/**
 * Locale resolution plus a cookie-PRESENCE guard.
 *
 * The word "presence" is doing real work. This middleware does not and must not
 * validate the token:
 *
 *   - it cannot. The signing key belongs to the backend (ADR-0027); giving the
 *     edge runtime a copy would put it in a second place, and the security of the
 *     system would then be the weaker of the two.
 *   - it should not. Every protected response is already authorised by the API on
 *     the actual request. Validating here would duplicate the decision, and a
 *     duplicated authorisation decision eventually disagrees with itself.
 *
 * So this is a UX optimisation: skip rendering a shell that is certain to 401, and
 * send the user straight to sign-in. A forged cookie gets past it and then gets a
 * 401 from the API, which is the correct outcome. Treating this as a security
 * boundary is the mistake to avoid — it is a redirect, not a gate.
 */
export default function middleware(request: NextRequest) {
  const path = stripLocale(request.nextUrl.pathname)
  const needsSession = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))

  if (needsSession && !request.cookies.has('access_token')) {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    // Preserve the destination so sign-in can return the user where they meant to
    // go. `searchParams.set` rather than string concatenation, so a path
    // containing `&` cannot inject a second parameter.
    url.search = ''
    url.searchParams.set('next', request.nextUrl.pathname)
    // A redirect carries the policy too. It has no scripts of its own, but a response that
    // omitted the header would be a gap an attacker could aim a victim at.
    return withCsp(NextResponse.redirect(url), newNonce())
  }

  const nonce = newNonce()

  /*
   * The nonce goes on the REQUEST, not just the response, and that is how Next learns it.
   *
   * Next reads a `nonce-` value out of the incoming `Content-Security-Policy` request header and
   * stamps it onto every script tag it emits. Setting only the response header would produce a
   * policy that blocks the application's own bootstrap — a blank page with a console full of
   * violations, on every route.
   */
  const headers = new Headers(request.headers)
  const policy = buildCsp({ nonce, isDevelopment })
  headers.set('content-security-policy', policy)
  headers.set('x-nonce', nonce)

  const response = intl(new NextRequest(request, { headers }))
  return withCsp(response, nonce, policy)
}

const isDevelopment = process.env.NODE_ENV === 'development'

/**
 * Attach the policy to an outgoing response.
 *
 * The nonce is recomputed for a redirect rather than threaded through, because a redirect's body
 * is empty — there is nothing for the nonce to authorise, and a shared one would only create the
 * impression that the two responses are related.
 */
const withCsp = <T extends Response>(response: T, nonce: string, policy?: string): T => {
  response.headers.set('content-security-policy', policy ?? buildCsp({ nonce, isDevelopment }))
  return response
}

export const config = {
  // Everything except API routes, static assets and files with an extension.
  // `/api` in particular must not be rewritten — the reverse proxy owns it
  // (ADR-0025), and a locale prefix on an API path would 404.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
