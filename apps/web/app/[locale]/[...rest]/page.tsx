import { notFound } from 'next/navigation'

/**
 * Turns an unmatched path into a real route inside the locale segment.
 *
 * Without this, an unknown URL falls through to Next's framework-level not-found page, which is
 * prerendered at build time — and a prerendered page carries no CSP nonce, so the policy refuses
 * all eleven of its scripts. The page still rendered, having no interactivity to lose, but every
 * mistyped URL produced a screenful of violations. A violation stream that is mostly noise is one
 * nobody reads on the day a real violation appears in it.
 *
 * Routing here means `[locale]/not-found.tsx` handles it instead: rendered per request, nonced,
 * translated. Specific routes still win over a catch-all, so nothing real is shadowed.
 */
export default function CatchAll(): never {
  notFound()
}
