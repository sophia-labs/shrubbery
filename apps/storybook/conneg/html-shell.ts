/**
 * html-shell.ts — the `dom`/html face for the conneg tooling.
 *
 * The pure @shrubbery/render package intentionally does NOT render dom (that is
 * the Lit runtime's job, and the SPA is not built in this spike). Both the live
 * conneg server AND the static face multiplier (build-static) need to emit an
 * html face, and they MUST emit the SAME bytes (so the static S3 layout and the
 * live cell agree). So the shell lives here, shared by both, built around the
 * markdown face: it is (a) valid for a browser, (b) carries the FAIR Signposting
 * Link metadata as <link> tags, and (c) inlines the markdown for a readable
 * fallback. The real SPA mount is the documented gated follow-up.
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Render the html face from a title, the already-rendered markdown body, and the
 * RFC 8288 Link-header value (the SAME link set every other face carries). The
 * Link header is reflected into <link> tags so the html face's link metadata is
 * byte-derived from the shared set — keeping all four faces' link sets in parity.
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
  <p><em>HTML face (SPA mount is the documented follow-up). The markdown face below is the default for bare curl.</em></p>
  <pre>${esc(markdown)}</pre>
</body>
</html>
`
}
