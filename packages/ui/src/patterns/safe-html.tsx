import { FilterXSS } from 'xss'
import { cn } from '../lib/cn'

/**
 * The only sanctioned path for rendering HTML in this codebase.
 * `dangerouslySetInnerHTML` is an ESLint error everywhere else.
 *
 * The threat is concrete, not theoretical. Coaches author notes, cues and
 * programme descriptions in TipTap; their athletes read them. That is
 * user-generated HTML crossing an account boundary — stored XSS that arrives with
 * a guaranteed audience and a trust relationship attached.
 *
 * Three decisions worth defending:
 *
 * 1. **Allowlist, not denylist.** A `FORBID_TAGS` list is a losing game, because
 *    the set of dangerous constructs grows with the platform. This permits exactly
 *    the tags TipTap can produce and drops everything else, so a new HTML feature
 *    is inert here until someone deliberately adds it.
 *
 * 2. **Sanitise at render, not only at write.** Content written before a sanitiser
 *    bug was fixed is already in the database. Sanitising on the way out means the
 *    fix applies retroactively. Writes are validated too, but this is the layer
 *    that has to hold.
 *
 * 3. **A DOM-free sanitiser, not DOMPurify.** DOMPurify needs a DOM, so making it
 *    isomorphic means shipping jsdom — which put several megabytes into the server
 *    bundle and broke `next build` outright, because jsdom reads its own stylesheet
 *    from disk at runtime. `xss` parses HTML directly and behaves identically in
 *    Node and the browser. That is the stronger property: the security guarantee no
 *    longer depends on which environment evaluated it, and there is one
 *    implementation rather than two that could diverge and produce a hydration
 *    mismatch resolving in the client's favour.
 */

/** Tag → permitted attributes. An attribute absent from a tag's list is dropped. */
const WHITELIST: Record<string, string[]> = {
  p: ['dir', 'lang'],
  br: [],
  strong: [],
  em: [],
  u: [],
  s: [],
  code: [],
  pre: [],
  blockquote: ['dir', 'lang'],
  h1: ['dir', 'lang'],
  h2: ['dir', 'lang'],
  h3: ['dir', 'lang'],
  h4: ['dir', 'lang'],
  ul: [],
  ol: [],
  li: [],
  a: ['href', 'target', 'rel', 'dir', 'lang'],
  span: ['dir', 'lang'],
  div: ['dir', 'lang'],
  hr: [],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'],
}

/**
 * URL schemes permitted in an href.
 *
 * An allowlist rather than a `javascript:`-denylist, because the interesting
 * bypasses are never the literal string — `data:text/html` executes in some
 * contexts, and `\tjavascript:` or `jAvAsCrIpT:` defeat naive matching. Anything
 * not matched here is dropped, including schemes nobody has invented yet.
 */
const SAFE_URL = /^(?:https?:\/\/|mailto:|tel:|\/|#|\.\/|\.\.\/)/i

const filter = new FilterXSS({
  whiteList: WHITELIST,
  // A tag outside the allowlist loses its markup but keeps its text. Silently
  // deleting a coach's paragraph because it contained one unsupported tag would be
  // a worse failure than showing it unstyled.
  stripIgnoreTag: true,
  // ...except for these, where the *content* is the payload. Keeping the text of a
  // <script> would render the attacker's source as visible page text, and keeping
  // a <style> body would let CSS exfiltrate via background-image.
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'],
  css: false,
  safeAttrValue: (tag, name, value) => {
    if (name === 'href') return SAFE_URL.test(value.trim()) ? value : ''
    if (name === 'target') return value === '_blank' ? value : ''
    return value
  },
  onTagAttr: (tag, name) => {
    // Any `on*` handler, whatever the tag. Belt and braces: none of these appear
    // in an allowlist above, but an allowlist edit is a one-line mistake away and
    // this is the failure that matters most.
    if (name.toLowerCase().startsWith('on')) return ''
    return undefined
  },
})

export interface SafeHtmlProps {
  html: string
  className?: string
  /** Rendered element. Use `span` inside a paragraph to keep the HTML valid. */
  as?: 'div' | 'span'
}

export const sanitizeHtml = (html: string): string => filter.process(html)

export const SafeHtml = ({ html, className, as = 'div' }: SafeHtmlProps) => {
  const clean = sanitizeHtml(html)
  const Tag = as
  return (
    <Tag
      className={cn('prose-fitnessos', className)}
      // Sanitised on the line above. This component is the reason the ESLint rule
      // banning this attribute exists, and the only file exempted from it.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  )
}
