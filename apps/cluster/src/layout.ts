/**
 * The one page layout of cluster.sophia-labs.com. No JavaScript of its own (a page may
 * name a live feature, which boots from /assets/features/), and no
 * Content-Security-Policy (neither a meta tag nor a header): the site is a static brochure
 * with no accounts or user data. If a policy is wanted, add it back to fit the finished design.
 *
 * Every URL the layout writes is root-absolute. The host serves /catalog (no
 * trailing slash) with catalog/index.html, and a relative href in that page
 * would resolve against /, not /catalog/.
 */

export interface Page {
  /** The <title>, from the page's front matter. */
  title: string
  /** The meta description, from the front matter (optional). */
  description?: string
  /** The rendered markdown body. */
  bodyHtml: string
  /**
   * A live feature from the front matter (e.g. "orb-v1"): its still frame
   * (/assets/features/<name>.svg) is part of the page; mount-v1.js swaps in the
   * animation (/assets/features/<name>.js) unless the reader prefers reduced motion.
   */
  feature?: string
  /** The page's slug (index, catalog, 404), written as main's class for page-specific layout. */
  page?: string
}

export interface Site {
  /** The exact commit the site was built from (40 hex), or "unknown" for a local build outside git. */
  commit: string
  /** Root-absolute URL of the content-hashed stylesheet, e.g. /assets/site.0123456789ab.css. */
  stylesheet: string
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderPage(page: Page, site: Site): string {
  const commit = escapeHtml(site.commit)
  const short = escapeHtml(site.commit.slice(0, 12))
  const description = page.description
    ? `\n<meta name="description" content="${escapeHtml(page.description)}">`
    : ''
  const name = page.feature ? escapeHtml(page.feature) : ''
  const feature = name ? `\n<figure class="feature" aria-hidden="true"><img src="/assets/features/${name}.svg" alt=""></figure>` : ''
  const boot = name ? `\n<script type="module" src="/assets/features/mount-v1.js" data-feature="${name}"></script>` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="build-commit" content="${commit}">
<title>${escapeHtml(page.title)}</title>${description}
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${escapeHtml(site.stylesheet)}">
</head>
<body>
<header class="site"><a href="/">Sophia Labs</a></header>
<main${page.page ? ` class="page-${escapeHtml(page.page)}"` : ''}>
${page.bodyHtml.trimEnd()}${feature}
</main>
<footer class="site"><code title="${commit}">${short}</code></footer>${boot}
</body>
</html>
`
}
