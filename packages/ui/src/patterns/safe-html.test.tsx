import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SafeHtml, sanitizeHtml } from './safe-html'

/**
 * These are security tests, not rendering tests. Each case is a real stored-XSS
 * vector against the coach-authors / athlete-reads path.
 *
 * They assert on `sanitizeHtml` rather than on the DOM wherever possible: the
 * sanitiser is where the guarantee lives, and asserting on the string catches a
 * payload that jsdom would silently decline to execute anyway.
 */
describe('sanitizeHtml', () => {
  it('strips a script tag', () => {
    expect(sanitizeHtml('<p>hello</p><script>alert(1)</script>')).toBe('<p>hello</p>')
  })

  it('strips an inline event handler while keeping the element', () => {
    const clean = sanitizeHtml('<p onclick="steal()">note</p>')
    expect(clean).not.toContain('onclick')
    expect(clean).toContain('note')
  })

  it('strips a javascript: href but keeps the link text', () => {
    const clean = sanitizeHtml('<a href="javascript:alert(1)">tap me</a>')
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('tap me')
  })

  it('strips an img onerror payload', () => {
    expect(sanitizeHtml('<img src=x onerror="alert(1)">')).not.toContain('onerror')
  })

  it('strips svg-based payloads, which the html profile excludes entirely', () => {
    const clean = sanitizeHtml('<svg><script>alert(1)</script></svg>')
    expect(clean).not.toContain('<svg')
    expect(clean).not.toContain('alert')
  })

  it('strips an iframe', () => {
    expect(sanitizeHtml('<iframe src="//evil.test"></iframe>')).not.toContain('iframe')
  })

  it('strips style attributes and tags, which can exfiltrate via background-image', () => {
    const clean = sanitizeHtml('<p style="background:url(//evil.test)">x</p><style>@import "//evil.test"</style>')
    expect(clean).not.toContain('evil.test')
  })

  it('strips data: URIs', () => {
    const clean = sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>')
    expect(clean).not.toContain('data:')
  })

  it('keeps the text of a disallowed tag rather than deleting the content', () => {
    // A coach losing a paragraph because it contained one unsupported tag is a
    // worse failure than seeing it unstyled.
    expect(sanitizeHtml('<marquee>3 sets of 8</marquee>')).toContain('3 sets of 8')
  })

  it('preserves the tags TipTap actually produces', () => {
    const html =
      '<h3>Warm-up</h3><ul><li><strong>Bike</strong> 5 min</li></ul>' +
      '<blockquote>keep the pace easy</blockquote>'
    expect(sanitizeHtml(html)).toBe(html)
  })

  it('preserves dir and lang, which RTL content depends on', () => {
    const html = '<p dir="rtl" lang="fa">سلام</p>'
    expect(sanitizeHtml(html)).toBe(html)
  })
})

describe('SafeHtml', () => {
  it('renders sanitised markup into the DOM', () => {
    render(<SafeHtml html="<p>coach note</p><script>alert(1)</script>" />)
    expect(screen.getByText('coach note')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })

  it('can render as a span so it stays valid inside a paragraph', () => {
    const { container } = render(<SafeHtml as="span" html="<strong>x</strong>" />)
    expect(container.firstElementChild?.tagName).toBe('SPAN')
  })
})
