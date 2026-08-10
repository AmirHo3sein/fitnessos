import { describe, expect, it } from 'vitest'
import { buildCsp, newNonce } from './csp'

const csp = (isDevelopment = false) => buildCsp({ nonce: 'TEST-NONCE', isDevelopment })
const directive = (policy: string, name: string) =>
  policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? ''

describe('script-src', () => {
  it('carries the nonce', () => {
    expect(directive(csp(), 'script-src')).toContain("'nonce-TEST-NONCE'")
  })

  it('never permits inline scripts', () => {
    // The assertion the whole header exists for. `'unsafe-inline'` here permits the attacker's
    // script alongside ours, which makes every other directive decorative.
    expect(directive(csp(), 'script-src')).not.toContain("'unsafe-inline'")
  })

  it('permits eval in development ONLY', () => {
    // Next's dev server compiles with eval-based source maps. Shipping the same relaxation to
    // production is how this header quietly stops meaning anything.
    expect(directive(csp(true), 'script-src')).toContain("'unsafe-eval'")
    expect(directive(csp(false), 'script-src')).not.toContain("'unsafe-eval'")
  })
})

describe('style-src', () => {
  it('permits inline styles and carries NO nonce', () => {
    /**
     * Deliberate, and the opposite of what symmetry with script-src suggests.
     *
     * Per CSP Level 3 a nonce never covers inline style ATTRIBUTES, and its presence causes
     * `'unsafe-inline'` to be ignored. A style nonce would therefore forbid every element
     * positioned by inline style — which is how React Aria positions overlays and how next/font
     * injects its faces — producing a policy that looks stricter and renders a broken page.
     */
    const styles = directive(csp(), 'style-src')
    expect(styles).toContain("'unsafe-inline'")
    expect(styles).not.toContain('nonce-')
  })
})

describe('the directives that close the remaining doors', () => {
  it.each([
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['frame-ancestors', "'none'"],
    ['frame-src', "'none'"],
    ['form-action', "'self'"],
    ['default-src', "'self'"],
  ])('%s is %s', (name, expected) => {
    expect(directive(csp(), name)).toBe(`${name} ${expected}`)
  })

  it('keeps connect-src same-origin, matching the reverse-proxy topology', () => {
    // Only correct because the API is same-origin (ADR-0025). Listing an API host would make
    // this header environment-specific and would outlive the host it named.
    expect(directive(csp(), 'connect-src')).toBe("connect-src 'self'")
  })

  it('upgrades to HTTPS in production but not in development', () => {
    // An upgrade in development breaks a plain-HTTP localhost server.
    expect(csp(false)).toContain('upgrade-insecure-requests')
    expect(csp(true)).not.toContain('upgrade-insecure-requests')
  })
})

describe('the nonce', () => {
  it('differs every time', () => {
    // A reused nonce is worth exactly as much to an attacker as no nonce, and the difference is
    // invisible in every test that only checks the header's shape.
    const nonces = new Set(Array.from({ length: 100 }, newNonce))
    expect(nonces.size).toBe(100)
  })

  it('carries at least the 128 bits the spec asks for', () => {
    // 16 bytes base64-encoded.
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })
})
