/**
 * scope-css.ts — a small, deterministic CSS selector scoper for the
 * `light-scoped` guest-island CSS strategy (S1 item 5; contracts/shrubbery.md
 * §1's light-DOM clause, EF-9's extension: "Flow's sheet carries three shadow
 * hazards ... styles.css:27 puts the whole whiteboard palette, font-family
 * and font-weight 300 on :root; styles.css:51-53 gives html, body, #root
 * height 100%").
 *
 * `light-scoped` mode injects a guest's stylesheet into the top-level
 * document ONCE per faceId (see `sh-guest-island.ts`) rather than isolating
 * it inside a shadow root — so it MUST be rewritten so it cannot bleed onto
 * `@shrubbery/tokens` or any other guest sharing the page (scout/shrubbery.md
 * §"Pitfalls": "Light-DOM needs an equivalent: scope third-party CSS under
 * `sh-flow-board` ... and rewrite `:root` selectors, or the island loses
 * Shrubbery's theme tokens").
 *
 * The rule (brief S1 item 5, verbatim): prefix every selector with the
 * scope; rewrite `:root`/`html`/`body` to the scope (they have no meaning
 * once every OTHER selector in the sheet is scoped under a container — the
 * guest's page-level rules become container-level rules); leave
 * `@keyframes`/`@font-face` bodies alone (a keyframe's `from`/`to`/percentage
 * selectors and a font-face's descriptor list are not element selectors —
 * prefixing them would silently break the animation/the face declaration,
 * not scope it).
 *
 * Pure, total, deterministic: same input bytes -> same output bytes, always
 * (no environment/clock/random dependency) — `scope-css.test.ts` pins one
 * fixture's output under a fixed checksum for exactly that reason.
 */

const OPAQUE_AT_RULE = /^@(?:-webkit-|-moz-|-o-|-ms-)?(?:keyframes|font-face)\b/i
const CONTAINER_AT_RULE = /^@(?:media|supports|layer|container)\b/i
const SCOPE_TARGET_SELECTORS = new Set([':root', 'html', 'body'])

/**
 * Rewrite every selector in `css` so it is scoped under `scopeSelector`
 * (e.g. `.sh-guest-mithras-flow`). `:root`, `html`, and `body` are REPLACED
 * with the scope selector itself (they become "the scope's own root"); every
 * other top-level selector is PREFIXED with the scope as a descendant
 * combinator. `@media`/`@supports`/`@layer`/`@container` bodies are
 * recursed into (their own nested rules need the same treatment);
 * `@keyframes`/`@font-face` blocks are copied verbatim, untouched.
 */
export function scopeCss(css: string, scopeSelector: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const braceIndex = indexOfNextBrace(css, i)
    if (braceIndex === -1) {
      out += css.slice(i)
      break
    }
    const prelude = css.slice(i, braceIndex).trim()
    // A comment with nothing else before an at-rule or :root/html/body — an
    // entirely ordinary CSS authoring pattern (Mithras Flow's own
    // styles.css: "/* brand faces */\n@font-face{...}", "/* whiteboard
    // palette */\n:root{...}") — must not hide that at-rule/target from the
    // classifier below: `prelude` itself still starts with the comment
    // text, so `OPAQUE_AT_RULE`/`SCOPE_TARGET_SELECTORS` would silently
    // miss it and fall through to the ordinary-selector branch, which for
    // `:root` produces `${scopeSelector} :root` — a descendant combinator
    // that can NEVER match anything, since the document's root element is
    // never a descendant of any other element. `matchPrelude` is ONLY for
    // classification; the at-rule branches still emit the ORIGINAL,
    // comment-preserving text (`css.slice(i, ...)` / `prelude`).
    const matchPrelude = stripLeadingComments(prelude)
    const closeIndex = indexOfMatchingClose(css, braceIndex)
    const body = css.slice(braceIndex + 1, closeIndex)

    if (OPAQUE_AT_RULE.test(matchPrelude)) {
      out += css.slice(i, closeIndex + 1)
    } else if (CONTAINER_AT_RULE.test(matchPrelude)) {
      out += `${prelude}{${scopeCss(body, scopeSelector)}}`
    } else {
      out += `${scopeSelectorList(prelude, scopeSelector)}{${body}}`
    }
    i = closeIndex + 1
  }
  return out
}

/** Strips one or more LEADING `/* ... *\/` comments (and the whitespace around them) so a pattern test can see the real selector/at-rule keyword past them. Never used for output — callers that need the original text keep using their own `prelude`/`raw`. */
function stripLeadingComments(text: string): string {
  let s = text
  for (;;) {
    const trimmed = s.replace(/^\s+/, '')
    if (!trimmed.startsWith('/*')) return trimmed
    const end = trimmed.indexOf('*/')
    if (end === -1) return trimmed // unterminated — leave as-is, let the normal (no-match) path handle it
    s = trimmed.slice(end + 2)
  }
}

function scopeSelectorList(selectorList: string, scopeSelector: string): string {
  return splitTopLevel(selectorList, ',')
    .map((raw) => {
      // A leading comment is stripped here too — see scopeCss's own
      // `matchPrelude` comment for why (one selector in a list can carry
      // the SAME "comment then :root" shape, e.g. `/* x */\n:root, .y`).
      const selector = stripLeadingComments(raw.trim()).replace(/\s+/g, ' ')
      if (selector.length === 0) return scopeSelector
      if (SCOPE_TARGET_SELECTORS.has(selector.toLowerCase())) return scopeSelector
      return `${scopeSelector} ${selector}`
    })
    .join(',')
}

/** Splits on `separator` at bracket/paren depth 0 only — `:is(a, b)` and `[attr="a,b"]` survive as one segment. */
function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    else if (ch === separator && depth === 0) {
      parts.push(value.slice(start, i))
      start = i + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

/** Next unquoted, uncommented `{`, or -1. */
function indexOfNextBrace(css: string, from: number): number {
  let i = from
  while (i < css.length) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      i = skipComment(css, i)
      continue
    }
    if (ch === '"' || ch === "'") {
      i = skipString(css, i)
      continue
    }
    if (ch === '{') return i
    i += 1
  }
  return -1
}

/** The index of the `}` that closes the block opened at `openIndex` (a `{`), skipping nested blocks/strings/comments. */
function indexOfMatchingClose(css: string, openIndex: number): number {
  let depth = 0
  let i = openIndex
  while (i < css.length) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      i = skipComment(css, i)
      continue
    }
    if (ch === '"' || ch === "'") {
      i = skipString(css, i)
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
    i += 1
  }
  return css.length - 1
}

function skipComment(css: string, from: number): number {
  const end = css.indexOf('*/', from + 2)
  return end === -1 ? css.length : end + 2
}

function skipString(css: string, from: number): number {
  const quote = css[from]
  let i = from + 1
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2
      continue
    }
    if (css[i] === quote) return i + 1
    i += 1
  }
  return css.length
}
