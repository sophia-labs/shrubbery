/**
 * @vitest-environment jsdom
 *
 * The security proof for the kernel's sanitization util.
 *
 * NO mocks: a REAL DOMPurify pass over real attacker-shaped HTML — the exact
 * close of the marked->unsafeHTML XSS hole the relocated chat render path would
 * otherwise carry. Mirrors editor-kernel's FORBIDDEN_* assertions against the
 * real artifact: we assert the dangerous tokens are GONE from the real sanitizer
 * output, not that a mock was called.
 *
 * WHY jsdom (not happy-dom) FOR THIS FILE: DOMPurify only runs correctly on a
 * spec-compliant DOM — jsdom is the substrate DOMPurify itself documents for
 * server-side use. happy-dom 15 (the package's default env, fine for the Lit
 * panel) does NOT reliably parse <script> into inert template content nor
 * round-trip block markup through DOMPurify's tree-walk, so DOMPurify degrades
 * there (it strips <p>/<h2> wrappers and can leak <script>). Testing the security
 * util against happy-dom's broken output would be a FALSE proof; jsdom gives a
 * REAL one. This is a no-mock scoping call: use the real DOM that exercises the
 * real sanitizer, per-file, without changing the package default env. jsdom is a
 * pure test-only dev dependency (no backend) and lives outside the src/ purity
 * closure (the tripwire grep excludes __tests__).
 */
import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from '../sanitize.js'

describe('sanitizeHtml — DOMPurify strips real XSS payloads (real jsdom DOM)', () => {
  it('removes a <script> tag from agent-rendered HTML, keeping benign prose', () => {
    const dirty = '<p>hi</p><script>window.__pwned = 1</script>'
    const clean = sanitizeHtml(dirty)
    expect(clean).toContain('<p>hi</p>')
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('__pwned')
  })

  it('strips an onerror handler off an <img> tag', () => {
    const dirty = '<img src="x" onerror="window.__pwned = 1">'
    const clean = sanitizeHtml(dirty)
    expect(clean).not.toContain('onerror')
    expect(clean).not.toContain('__pwned')
  })

  it('neutralizes a javascript: href while preserving benign markup', () => {
    const dirty = '<a href="javascript:window.__pwned=1">click</a><strong>safe</strong>'
    const clean = sanitizeHtml(dirty)
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('<strong>safe</strong>')
    expect(clean).toContain('click')
  })

  it('strips a <script> embedded amongst multi-part prose (the common agent shape)', () => {
    // Mirrors the renderContent text-part branch: prose with an interleaved
    // payload, not just a lone <script>.
    const dirty =
      '<p>Here is the answer.</p>' +
      '<img src=x onerror="fetch(`/steal?c=${document.cookie}`)">' +
      '<p>Done.</p><script>document.location="//evil"</script>'
    const clean = sanitizeHtml(dirty)
    expect(clean).toContain('<p>Here is the answer.</p>')
    expect(clean).toContain('<p>Done.</p>')
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('onerror')
    expect(clean).not.toContain('evil')
  })

  it('preserves the prose markup marked produces (the path is wrapped, not broken)', () => {
    // A realistic marked-output shape: headings, emphasis, lists, links.
    const proseHtml =
      '<h2>Funes</h2><p>He could <em>not</em> forget. ' +
      '<a href="https://example.com">source</a></p><ul><li>memory</li></ul>'
    const clean = sanitizeHtml(proseHtml)
    expect(clean).toContain('<h2>Funes</h2>')
    expect(clean).toContain('<em>not</em>')
    expect(clean).toContain('<li>memory</li>')
    expect(clean).toContain('href="https://example.com"')
  })
})
