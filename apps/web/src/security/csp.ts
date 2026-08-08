/**
 * Content Security Policy (handbook Part 5).
 *
 * The policy that matters is `script-src 'self' 'nonce-…'` with no `'unsafe-inline'`. Everything
 * else here is either supporting that or closing a hole it would otherwise leave open.
 *
 * ## Why a nonce rather than `'unsafe-inline'`
 *
 * Next's App Router streams the RSC payload through inline `<script>` tags, so *something* has to
 * permit inline scripts. `'unsafe-inline'` permits all of them — including one an attacker
 * injects — which makes the whole header decorative. A nonce permits exactly the ones this server
 * emitted on this request.
 *
 * The cost is real and is paid deliberately: a nonce is per-request, so a page carrying one
 * cannot be prerendered at build time. The two routes that were static — the public page and
 * sign-in — become dynamic. That trade is worth taking on sign-in in particular, which is the
 * page where an injected script is worth the most to an attacker.
 *
 * ## Why `style-src` keeps `'unsafe-inline'`
 *
 * This is the part the handbook flagged to verify, and the answer is not the one the symmetry
 * suggests.
 *
 * A nonce on `style-src` does not help: per CSP Level 3, inline STYLE ATTRIBUTES (`style="…"`)
 * are never covered by a nonce, and the presence of a nonce causes `'unsafe-inline'` to be
 * *ignored*. So adding a style nonce would break every element positioned by inline style —
 * which is how React Aria positions overlays, and how `next/font` injects its face declarations.
 * The result would be a policy that looks stricter and renders a broken page.
 *
 * `'unsafe-inline'` for styles is a genuine weakening and a much smaller one: CSS injection can
 * exfiltrate some data through selectors and background URLs, which `img-src 'self'` and
 * `connect-src 'self'` already constrain. It cannot execute.
 *
 * ## Development
 *
 * `'unsafe-eval'` is added in development only. Next's dev server compiles with eval-based source
 * maps and hot reload does not work without it. Gating on `NODE_ENV` rather than shipping it
 * everywhere is the entire point — a policy relaxed for a dev-only tool, in production, is how
 * this header quietly stops meaning anything.
 */

export interface CspOptions {
  readonly nonce: string
  readonly isDevelopment: boolean
}

export const buildCsp = ({ nonce, isDevelopment }: CspOptions): string => {
  const directives: readonly (readonly [string, readonly string[]])[] = [
    ["default-src", ["'self'"]],
    [
      'script-src',
      [
        "'self'",
        `'nonce-${nonce}'`,
        // `strict-dynamic` lets a nonced script load the chunks it needs without every chunk URL
        // being enumerated. It also makes `'self'` ignored by browsers that support it, which is
        // the intended behaviour: trust flows from the nonce, not from the origin.
        "'strict-dynamic'",
        ...(isDevelopment ? ["'unsafe-eval'"] : []),
      ],
    ],
    // See the header note. A nonce here would break React Aria's positioning and next/font.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    // next/font self-hosts at build time, so no font CDN is needed — and not listing one means a
    // stylesheet that tried to pull a remote font would be blocked.
    ['font-src', ["'self'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    // Same-origin API (ADR-0025). A policy listing an API host would be a policy that has to
    // change per environment, and one that quietly permits a host we no longer use.
    ['connect-src', ["'self'"]],
    ['object-src', ["'none'"]],
    // Neither is used, and both are how a stolen origin gets a foothold.
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    // The modern replacement for X-Frame-Options, which is kept alongside it only for browsers
    // that do not implement this one.
    ['frame-ancestors', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
  ]

  const rendered = directives.map(([name, values]) => `${name} ${values.join(' ')}`)

  // Only in production. In development an upgrade to HTTPS breaks a plain-HTTP localhost server.
  if (!isDevelopment) rendered.push('upgrade-insecure-requests')

  return rendered.join('; ')
}

/**
 * A fresh nonce per request.
 *
 * `crypto.getRandomValues`, not `Math.random()`: a predictable nonce is exactly as useful to an
 * attacker as no nonce at all, and it would be invisible in every test.
 *
 * Base64 of 16 bytes. The spec requires at least 128 bits of entropy.
 */
export const newNonce = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
