/**
 * scope-css.test.ts — S1's deterministic-snapshot fixture for `scopeCss`
 * (brief: ":root{--x:1}, body{margin:0}, .a,.b>.c{}, @media
 * (min-width:1px){.d{}}, @keyframes k{from{}to{}}, @font-face{}; checksum
 * stable across two runs"). No mocks: this is a pure function over strings,
 * exercised for real.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { scopeCss } from '../scope-css.js'

const SCOPE = '.sh-guest-test'

const FIXTURE = ':root{--x:1}' + 'body{margin:0}' + '.a,.b>.c{}' + '@media (min-width:1px){.d{}}' + '@keyframes k{from{}to{}}' + '@font-face{}'

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

describe('scopeCss', () => {
  it('rewrites :root/body to the scope, prefixes ordinary selectors, recurses into @media, and copies @keyframes/@font-face verbatim', () => {
    const output = scopeCss(FIXTURE, SCOPE)
    expect(output).toBe(
      `${SCOPE}{--x:1}` +
        `${SCOPE}{margin:0}` +
        `${SCOPE} .a,${SCOPE} .b>.c{}` +
        `@media (min-width:1px){${SCOPE} .d{}}` +
        `@keyframes k{from{}to{}}` +
        `@font-face{}`,
    )
  })

  it('rewrites html the same way :root and body are rewritten (to the scope, not prefixed)', () => {
    expect(scopeCss('html{color:red}', SCOPE)).toBe(`${SCOPE}{color:red}`)
  })

  it('prefixes every selector in a longer comma-separated list, independently, in order', () => {
    expect(scopeCss('.x,.y,.z{}', SCOPE)).toBe(`${SCOPE} .x,${SCOPE} .y,${SCOPE} .z{}`)
  })

  it('a selector with a comma inside :is(...) is not split there', () => {
    expect(scopeCss(':is(.a,.b){color:blue}', SCOPE)).toBe(`${SCOPE} :is(.a,.b){color:blue}`)
  })

  it('leaves @font-face and @keyframes bodies completely untouched, including nested keyframe selectors', () => {
    const css = '@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}'
    expect(scopeCss(css, SCOPE)).toBe(css)
  })

  it('is a pure, total function: identical input bytes always produce identical output bytes', () => {
    const first = scopeCss(FIXTURE, SCOPE)
    const second = scopeCss(FIXTURE, SCOPE)
    expect(first).toBe(second)
  })

  it('produces a checksum that is stable across two independent runs (the brief\'s own acceptance: "checksum stable across two runs")', () => {
    const firstDigest = sha256(scopeCss(FIXTURE, SCOPE))
    const secondDigest = sha256(scopeCss(FIXTURE, SCOPE))
    expect(firstDigest).toBe(secondDigest)
    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  // Found building Mithras Flow's `apps/flow` (S2): a comment immediately
  // preceding an at-rule or :root/html/body — nothing else before it, only
  // whitespace — is a completely ordinary CSS authoring pattern (Mithras
  // Flow's own styles.css opens with exactly this: "/* brand faces (from
  // the homepage) */\n@font-face{...}", then later "/* whiteboard palette:
  // ... */\n:root{...font-family:'GT Eesti',...}"). `indexOfNextBrace`
  // already skips PAST comments while hunting for the brace (so it finds
  // the RIGHT brace), but the `prelude` extracted for pattern-matching was
  // the raw slice INCLUDING that leading comment text — so
  // `OPAQUE_AT_RULE.test(prelude)` and the `:root`/`html`/`body` exact-match
  // both silently failed (a prelude starting with `/*` never matches
  // `/^@.../`, and never string-equals `':root'`), and the rule fell
  // through to the ORDINARY-selector branch instead: `@font-face` got
  // treated as a selector and incorrectly scoped (corrupting the font
  // declaration), and `:root` got rewritten to `${SCOPE} :root` — a
  // descendant combinator that can NEVER match anything, since `:root`
  // (the document's root element) is never a descendant of any other
  // element. Measured effect: every element under the scope silently loses
  // ALL of :root's inherited properties (font-family, font-weight, color)
  // and falls back to the user-agent default — exactly the "pixel-perfect
  // failure mode that looks exactly like success" contracts/shrubbery.md
  // §1 warns about, just from a different cause (a leading comment, not a
  // shadow boundary) than the one the sitting recorded.
  it('a comment immediately before @font-face does not defeat the opaque-at-rule match', () => {
    const css = '/* brand faces */\n@font-face{font-family:"X";src:url(x.woff2)}'
    expect(scopeCss(css, SCOPE)).toBe(css)
  })

  it('a comment immediately before :root does not defeat the root-target match (the concrete bug: it must NOT become "SCOPE :root", which can never match anything)', () => {
    const css = '/* whiteboard palette */\n:root{font-family:sans-serif}'
    const output = scopeCss(css, SCOPE)
    expect(output).not.toContain(`${SCOPE} :root`)
    expect(output).toContain(`${SCOPE}{font-family:sans-serif}`)
  })

  it('a comment immediately before an ordinary selector still scopes it (comment stripped from the match, not from the selector\'s meaning)', () => {
    const css = '/* note */\n.foo{color:red}'
    expect(scopeCss(css, SCOPE)).toBe(`${SCOPE} .foo{color:red}`)
  })
})
