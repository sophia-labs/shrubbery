/**
 * html-shell.ts — the DOM-FACE FLOOR (design §3.1, R5), adapted VERBATIM in
 * shape from `apps/storybook/conneg/html-shell.ts` (that copy stays — it is
 * NOT retired by the negotiate hoist, only the two `negotiate.ts` copies were).
 *
 * The pure @shrubbery/render package intentionally does NOT render `dom` for a
 * `workspace` resource (`render-dom.ts` throws for it by design — Lit DOM is
 * @shrubbery/runtime's job, out of scope here). So the html face is built HERE,
 * around the ALREADY-RENDERED hypertext (markdown, footer included) body: it is
 * (a) valid for a browser, (b) carries the FAIR Signposting Link metadata as
 * `<link>` tags reflected byte-for-byte off the same Link header every other
 * face carries (link-set parity), and (c) inlines the markdown for a readable
 * fallback. Zero SSR entanglement — the real SPA mount is U11, a named
 * follow-up, never faked here.
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Render the html face from a title, the already-rendered markdown body
 * (testimony footer already appended by the caller), and the RFC 8288
 * Link-header value (the SAME link set every other face carries).
 */
export function htmlShell(title: string, markdown: string, linkHeader: string): string {
  const linkTags = linkHeader
    .split(/,\s*(?=<)/)
    .map((part) => {
      const m = /^<([^>]+)>;\s*rel="([^"]+)";\s*type="([^"]+)"/.exec(part.trim())
      return m ? `<link rel="${m[2]}" href="${m[1]}" type="${m[3]}">` : ''
    })
    .filter(Boolean)
    .join('\n  ')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  ${linkTags}
</head>
<body>
  <p><em>HTML face (the real SPA mount is U11, the documented follow-up). The markdown face below is the default for bare curl.</em></p>
  <pre>${esc(markdown)}</pre>
</body>
</html>
`
}
