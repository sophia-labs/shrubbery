/**
 * seed-html.ts — the constitution's initial body, as HTML.
 *
 * Shared between the browser acceptance script (which loads it into a real,
 * live, CRDT-backed editor through the host's public `restoreHtml`) and the
 * round-trip test that proves the seeding is byte-lossless. One definition, so
 * the test cannot drift from what the script actually inserts.
 *
 * HTML escaping is the only transformation applied to `source`, and
 * `<pre>`/`<code class="language-seele">` is the pair TipTap's `codeBlock`
 * parses back into a `seele`-tagged fence with `preserveWhitespace: 'full'` —
 * so blank lines, leading indentation, and `&`/`<`/`>` all survive intact.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A heading, a paragraph of prose, and exactly ONE `seele` fence carrying `source`. */
export function seeleFenceHtml(title: string, prose: string, source: string): string {
  return (
    `<h1>${escapeHtml(title)}</h1>` +
    `<p>${escapeHtml(prose)}</p>` +
    `<pre><code class="language-seele">${escapeHtml(source)}</code></pre>`
  )
}
