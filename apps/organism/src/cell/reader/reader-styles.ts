/**
 * The Reader's look: one quiet bar, the work in the middle, a margin for notes. House tokens only, with the Reader's own
 * names (`--rd-*`) as the seam a skin can re-point. pdf.js's viewer stylesheet is adopted into the same shadow root
 * (its `:root` variables re-scoped to `:host`), so nothing is injected into the page.
 */
import { css, unsafeCSS, type CSSResult } from 'lit'
import pdfViewerCss from 'pdfjs-dist/web/pdf_viewer.css?inline'

export const PDF_VIEWER_STYLES: CSSResult = unsafeCSS(pdfViewerCss.replaceAll(':root', ':host'))

/** What each highlighter colour looks like, painted under the text (the names are what is stored). */
export function highlightRules(prefix: string): string {
  const wash: Readonly<Record<string, string>> = {
    yellow: 'var(--rd-hl-yellow)', green: 'var(--rd-hl-green)', blue: 'var(--rd-hl-blue)', pink: 'var(--rd-hl-pink)',
  }
  return [
    ...Object.entries(wash).map(([name, value]) => `::highlight(${prefix}-${name}) { background-color: ${value}; color: inherit; }`),
    `::highlight(${prefix}-note) { text-decoration: underline; text-decoration-color: var(--rd-note-line); text-decoration-thickness: 2px; text-underline-offset: 3px; }`,
    `::highlight(${prefix}-active) { background-color: var(--rd-hl-active); }`,
    `::highlight(${prefix}-find) { background-color: var(--rd-find); }`,
    `::highlight(${prefix}-find-current) { background-color: var(--rd-find-current); }`,
  ].join('\n')
}


/** The Reader's tokens, on the host of anything that draws its chrome (the Reader, its bar). */
export const READER_TOKENS: CSSResult = css`
  :host {
    --rd-bar-h: 44px;
    --rd-chrome: var(--mn-color-surface-chrome, var(--mn-color-surface-panel, #f6f5f2));
    --rd-canvas: var(--mn-color-surface-sunken, #ecebe7);
    --rd-paper: var(--mn-color-surface-editor, var(--mn-color-surface-base, #fffdf8));
    --rd-ink: var(--mn-color-text-primary, #1f2328);
    --rd-muted: var(--mn-color-text-secondary, #59606a);
    --rd-quiet: var(--mn-color-text-tertiary, #8a9099);
    --rd-rule: var(--mn-color-border-subtle, rgba(0, 0, 0, 0.08));
    --rd-rule-strong: var(--mn-color-border-default, rgba(0, 0, 0, 0.14));
    --rd-hover: var(--mn-color-surface-hover, rgba(0, 0, 0, 0.05));
    --rd-pressed: var(--mn-color-surface-accent-subtle, rgba(46, 107, 74, 0.12));
    --rd-accent: var(--mn-color-accent, #2e6b4a);
    --rd-focus: var(--mn-color-border-focus, #2e6b4a);
    --rd-raised: var(--mn-color-surface-raised, #ffffff);
    --rd-shadow-pop: var(--mn-shadow-popover, 0 8px 28px rgba(0, 0, 0, 0.16));
    --rd-page-shadow: 0 1px 2px rgba(0, 0, 0, 0.10), 0 6px 22px rgba(0, 0, 0, 0.09);
    --rd-hl-yellow: rgba(250, 204, 21, 0.40);
    --rd-hl-green: rgba(74, 200, 120, 0.32);
    --rd-hl-blue: rgba(86, 156, 245, 0.30);
    --rd-hl-pink: rgba(240, 110, 170, 0.28);
    --rd-hl-active: rgba(250, 170, 40, 0.30);
    --rd-note-line: rgba(200, 120, 20, 0.85);
    --rd-find: rgba(86, 156, 245, 0.28);
    --rd-find-current: rgba(250, 140, 40, 0.55);
  }
`

/** The one bar: sidebar | title and author | location | tools | Original / Text | more. The same in every view. */
export const READER_BAR_STYLES: CSSResult = css`
  :host { display: block; flex: 0 0 auto; position: relative; z-index: 3; container: rbar / inline-size; font-family: var(--mn-font-chrome, system-ui, sans-serif); font-size: var(--mn-text-sm, 13px); color: var(--rd-ink); }
  [hidden] { display: none !important; }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; }
  /* --- the bar ------------------------------------------------------------------------------------------------------ */
  .bar {
    height: var(--rd-bar-h);
    display: flex;
    align-items: center;
    gap: var(--mn-space-2, 8px);
    padding: 0 var(--mn-space-2, 8px);
    background: var(--rd-chrome);
    border-bottom: 1px solid var(--rd-rule);
    position: relative;
    z-index: 3;
  }
  .bar-start, .bar-end { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .bar-start { flex: 0 1 auto; max-width: 34%; }
  .bar-end { flex: 0 0 auto; justify-content: flex-end; }
  .title { display: flex; flex-direction: column; min-width: 0; margin-left: var(--mn-space-1, 4px); line-height: 1.2; }
  .title b { font-weight: var(--mn-font-weight-semibold, 600); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title small { color: var(--rd-muted); font-size: var(--mn-text-xs, 12px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sep { width: 1px; height: 18px; background: var(--rd-rule-strong); margin: 0 var(--mn-space-1-5, 6px); flex: none; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-width: 30px; height: 30px; padding: 0 7px;
    border: 0; border-radius: var(--mn-radius-control, 6px); background: transparent; cursor: pointer;
    color: var(--rd-muted);
  }
  .btn:hover:not(:disabled) { background: var(--rd-hover); color: var(--rd-ink); }
  .btn[aria-pressed='true'] { background: var(--rd-pressed); color: var(--rd-accent); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn:focus-visible, .seg button:focus-visible, .loc input:focus-visible, .loc-slot input:focus-visible { outline: 2px solid var(--rd-focus); outline-offset: 1px; }
  .btn svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .btn .count { font-size: var(--mn-text-xs, 12px); font-variant-numeric: tabular-nums; }

  .loc-slot, .tools { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .loc, .loc-slot { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 2px; color: var(--rd-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .loc input, .loc-slot input {
    width: 3.4em; height: 26px; text-align: center; font: inherit; color: var(--rd-ink);
    background: var(--rd-raised); border: 1px solid var(--rd-rule-strong); border-radius: var(--mn-radius-sm, 4px);
  }
  .loc .of, .loc-slot .of { padding: 0 4px 0 6px; }
  .loc .where, .loc-slot .where { flex: 0 1 auto; min-width: 0; max-width: 24em; overflow: hidden; text-overflow: ellipsis; color: var(--rd-ink); padding: 0 6px; }
  .loc .pct, .loc-slot .pct { flex: none; color: var(--rd-quiet); }

  .zoom { min-width: 3.4em; text-align: center; color: var(--rd-muted); font-variant-numeric: tabular-nums; }

  .seg { display: inline-flex; padding: 2px; border-radius: var(--mn-radius-control, 6px); background: var(--rd-hover); }
  .seg button {
    height: 26px; padding: 0 10px; border: 0; border-radius: calc(var(--mn-radius-control, 6px) - 2px);
    background: transparent; color: var(--rd-muted); cursor: pointer;
  }
  .seg button[aria-pressed='true'] { background: var(--rd-raised); color: var(--rd-ink); box-shadow: var(--mn-shadow-xs, 0 1px 2px rgba(0, 0, 0, 0.08)); }

  .bar-progress { position: absolute; left: 0; bottom: -1px; height: 2px; background: var(--rd-accent); opacity: 0.55; transition: width 200ms ease; }
  .bar-error { margin: 0; padding: 6px 12px; background: var(--rd-chrome); color: var(--mn-color-text-danger, #b42318); border-bottom: 1px solid var(--rd-rule); font-size: var(--mn-text-xs, 12px); }
  .status { color: var(--rd-muted); font-size: var(--mn-text-xs, 12px); }
  .find-pop {
    position: absolute; top: calc(100% + 8px); right: 14px; z-index: 4; display: flex; align-items: center; gap: 2px;
    padding: 4px 4px 4px 10px; background: var(--rd-raised); border: 1px solid var(--rd-rule-strong);
    border-radius: var(--mn-radius-md, 8px); box-shadow: var(--rd-shadow-pop);
  }
  .find-pop input { width: 200px; border: 0; outline: none; background: transparent; font: inherit; color: var(--rd-ink); }
  .find-pop .count { color: var(--rd-quiet); font-size: var(--mn-text-xs, 12px); min-width: 5.5em; text-align: right; padding-right: 4px; font-variant-numeric: tabular-nums; }
  @container rbar (max-width: 640px) {
    .title small, .status { display: none; }
  }
`

export const READER_STYLES: CSSResult = css`
  :host {
    /* the tokens: READER_TOKENS */
    --rd-type-size: 1.125rem;
    --rd-measure: 34em;
    --rd-face: var(--mn-font-prose, Georgia, serif);

    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    height: 100%;
    flex: 1 1 auto;
    color: var(--rd-ink);
    background: var(--rd-canvas);
    font-family: var(--mn-font-chrome, system-ui, sans-serif);
    font-size: var(--mn-text-sm, 13px);
    container: reader / inline-size;
  }
  :host([data-kind='epub']) { --rd-canvas: var(--rd-paper); }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; }
  [hidden] { display: none !important; }

  /* --- body: sidebar | stage | margin -------------------------------------------------------------------------------- */
  .body { flex: 1 1 auto; display: flex; min-height: 0; position: relative; }
  .side {
    flex: 0 0 248px; display: flex; flex-direction: column; min-height: 0;
    background: var(--rd-chrome); border-right: 1px solid var(--rd-rule);
  }
  .tabs { display: flex; gap: 2px; padding: var(--mn-space-2, 8px); border-bottom: 1px solid var(--rd-rule); }
  .tabs button {
    flex: 1; height: 26px; border: 0; border-radius: var(--mn-radius-sm, 4px); background: transparent; color: var(--rd-muted); cursor: pointer;
  }
  .tabs button[aria-selected='true'] { background: var(--rd-hover); color: var(--rd-ink); font-weight: var(--mn-font-weight-medium, 500); }
  .side-scroll { flex: 1 1 auto; overflow: auto; padding: var(--mn-space-2, 8px) var(--mn-space-1-5, 6px) var(--mn-space-6, 24px); }
  .toc ul { list-style: none; margin: 0; padding: 0; }
  .toc ul ul { padding-left: 12px; }
  .toc button {
    display: block; width: 100%; text-align: left; border: 0; background: transparent; cursor: pointer;
    padding: 5px 8px; border-radius: var(--mn-radius-sm, 4px); color: var(--rd-ink); line-height: 1.35;
  }
  .toc button:hover { background: var(--rd-hover); }
  .toc button[aria-current='true'] { background: var(--rd-pressed); color: var(--rd-accent); }
  .thumbs { display: grid; gap: 14px; justify-items: center; padding: 6px 0; }
  .thumb { display: grid; gap: 4px; justify-items: center; border: 0; background: transparent; cursor: pointer; color: var(--rd-muted); font-size: var(--mn-text-xs, 12px); }
  .thumb canvas { width: 132px; background: #fff; box-shadow: var(--rd-page-shadow); border-radius: 1px; outline: 2px solid transparent; outline-offset: 3px; }
  .thumb[aria-current='page'] canvas { outline-color: var(--rd-accent); }
  .thumb[aria-current='page'] { color: var(--rd-accent); }
  .empty { color: var(--rd-quiet); padding: 8px; line-height: 1.5; }

  .notes-list { display: grid; gap: 4px; }
  .note-row {
    display: grid; gap: 4px; text-align: left; border: 0; background: transparent; cursor: pointer;
    padding: 8px; border-radius: var(--mn-radius-sm, 4px); color: var(--rd-ink);
  }
  .note-row:hover { background: var(--rd-hover); }
  .note-row q { font-family: var(--rd-face); color: var(--rd-muted); quotes: none; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .note-row .meta { display: flex; gap: 6px; align-items: center; color: var(--rd-quiet); font-size: var(--mn-text-xs, 12px); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; display: inline-block; }
  .dot[data-color='yellow'] { background: rgb(234, 179, 8); }
  .dot[data-color='green'] { background: rgb(34, 160, 90); }
  .dot[data-color='blue'] { background: rgb(59, 130, 246); }
  .dot[data-color='pink'] { background: rgb(219, 39, 119); }

  .stage { flex: 1 1 auto; min-width: 0; position: relative; }

  /* --- PDF ---------------------------------------------------------------------------------------------------------- */
  .pdf { position: absolute; inset: 0; overflow: auto; background: var(--rd-canvas); outline: none; }
  .pdf .pdfViewer { padding: 22px 0 48px; }
  .pdf .pdfViewer .page { margin: 0 auto 18px; box-shadow: var(--rd-page-shadow); border: 0; }
  .pdf .textLayer ::selection { background: rgba(86, 156, 245, 0.32); }

  /* --- EPUB --------------------------------------------------------------------------------------------------------- */
  .book { position: absolute; inset: 0; overflow: auto; background: var(--rd-paper); outline: none; scroll-behavior: auto; }
  .chapter {
    max-width: var(--rd-measure);
    margin: 0 auto;
    padding: 56px 28px 40px;
    font-family: var(--rd-face);
    font-size: var(--rd-type-size);
    line-height: var(--mn-leading-prose, 1.65);
    color: var(--rd-ink);
    hyphens: auto;
    -webkit-hyphens: auto;
    text-align: justify;
    text-wrap: pretty;
    font-variant-numeric: oldstyle-nums proportional-nums;
    font-kerning: normal;
    position: relative;
  }
  :host([data-justify='off']) .chapter { text-align: left; hyphens: manual; }
  .chapter p { margin: 0; text-indent: 1.4em; }
  .chapter :is(h1, h2, h3, h4, h5, h6, hr, blockquote, figure, table, ul, ol, div, pre, .center) + p,
  .chapter p:first-child, .chapter p.noindent, .chapter p[class*='nind'] { text-indent: 0; }
  .chapter :is(h1, h2, h3, h4, h5, h6) {
    text-align: center; hyphens: manual; font-weight: 500; line-height: 1.3; text-wrap: balance;
    margin: 2.2em 0 1.2em; letter-spacing: 0.01em;
  }
  .chapter h1 { font-size: 1.6em; }
  .chapter h2 { font-size: 1.35em; }
  .chapter h3 { font-size: 1.15em; }
  .chapter :is(h4, h5, h6) { font-size: 1em; font-style: italic; }
  .chapter > :first-child { margin-top: 0; }
  .chapter blockquote { margin: 1em 1.6em; font-size: 0.95em; }
  .chapter blockquote p { text-indent: 0; margin: 0.4em 0; }
  .chapter hr { border: 0; text-align: center; margin: 1.6em 0; height: 1em; }
  .chapter hr::after { content: '⁂'; color: var(--rd-quiet); }
  .chapter img { max-width: 100%; height: auto; display: block; margin: 1.2em auto; }
  .chapter figure { margin: 1.4em 0; text-align: center; }
  .chapter figcaption { font-size: 0.85em; color: var(--rd-muted); text-indent: 0; }
  .chapter table { border-collapse: collapse; margin: 1em auto; font-size: 0.9em; text-align: left; hyphens: manual; }
  .chapter td, .chapter th { padding: 0.2em 0.6em; vertical-align: top; }
  .chapter a { color: var(--mn-color-text-link, var(--rd-accent)); text-decoration: none; overflow-wrap: anywhere; hyphens: manual; }
  .chapter a:hover { text-decoration: underline; }
  .chapter a[data-rd-chapter] { cursor: pointer; }
  .chapter sup, .chapter sub { line-height: 0; }
  .chapter .smcap, .chapter .sc, .chapter .smallcaps { font-variant: small-caps; letter-spacing: 0.02em; }
  .chapter .center, .chapter .c { text-align: center; text-indent: 0; }
  .chapter .right { text-align: right; }
  .chapter :is(.poem, .poetry, .verse) { margin: 1em 0 1em 2em; text-align: left; hyphens: manual; }
  .chapter :is(.poem, .poetry, .verse) :is(p, div, span.i0, span.i2) { text-indent: 0; }
  .chapter :is(.footnote, .footnotes) { font-size: 0.88em; line-height: 1.5; color: var(--rd-muted); }
  .chapter :is(.footnote, .footnotes) p { text-indent: 0; margin: 0.4em 0; }
  .chapter .rd-pagenum {
    position: absolute; left: -2.8rem; width: 2.4rem; text-align: right;
    font-family: var(--mn-font-chrome, sans-serif); font-size: 11px; line-height: 1; letter-spacing: 0.02em;
    color: var(--rd-quiet); text-indent: 0; font-style: normal; font-weight: 400; user-select: none;
    margin-top: 0.45em;
  }
  .chapter .rd-pagenum::before { content: attr(data-page); }
  @container reader (max-width: 720px) {
    .chapter { padding: 32px 20px; }
    .chapter .rd-pagenum { display: none; }
  }
  .chapter-nav {
    max-width: var(--rd-measure); margin: 0 auto; padding: 8px 28px 72px;
    display: flex; justify-content: space-between; gap: 12px; font-family: var(--mn-font-chrome, sans-serif);
  }
  .chapter-nav button {
    display: grid; gap: 2px; text-align: left; max-width: 48%;
    border: 1px solid var(--rd-rule); border-radius: var(--mn-radius-md, 8px); background: transparent;
    padding: 10px 14px; cursor: pointer; color: var(--rd-ink);
  }
  .chapter-nav button:hover { background: var(--rd-hover); }
  .chapter-nav button[data-next] { text-align: right; margin-left: auto; }
  .chapter-nav small { color: var(--rd-quiet); font-size: var(--mn-text-xs, 12px); }

  /* --- margin ------------------------------------------------------------------------------------------------------- */
  .margin {
    flex: 0 0 272px; position: relative; overflow: hidden;
    background: var(--rd-chrome); border-left: 1px solid var(--rd-rule);
  }
  :host([data-kind='epub']) .margin { background: var(--rd-paper); border-left-color: transparent; }
  .margin-note {
    position: absolute; left: 12px; right: 14px; top: 0;
    padding: 8px 10px 9px; border-radius: var(--mn-radius-md, 8px);
    background: var(--rd-raised); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); border: 1px solid var(--rd-rule);
    border-left: 3px solid var(--rd-note-color, rgb(234, 179, 8));
    font-size: var(--mn-text-sm, 13px); line-height: 1.45; cursor: pointer;
    transition: box-shadow 120ms ease;
  }
  .margin-note[data-active] { box-shadow: var(--rd-shadow-pop); border-color: var(--rd-rule-strong); }
  .margin-note .who { color: var(--rd-quiet); font-size: var(--mn-text-xs, 12px); margin-bottom: 2px; display: flex; gap: 6px; }
  .margin-note[data-unplaced] { visibility: hidden; pointer-events: none; }
  .margin-note .words { white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .margin-note:hover { z-index: 1; box-shadow: var(--rd-shadow-pop); }
  .margin-note:hover .words { -webkit-line-clamp: unset; display: block; }
  .margin-note[data-active] .words { -webkit-line-clamp: unset; display: block; }
  .margin-empty { position: absolute; top: 18px; left: 16px; right: 16px; color: var(--rd-quiet); line-height: 1.5; }

  /* A narrow Reader keeps the page whole: the sidebar and the margin open over it, when asked for. */
  :host([data-narrow]) .margin { position: absolute; right: 0; top: 0; bottom: 0; width: 272px; z-index: 2; box-shadow: var(--rd-shadow-pop); background: var(--rd-chrome); border-left: 1px solid var(--rd-rule); }
  :host([data-narrow]) .side { position: absolute; left: 0; top: 0; bottom: 0; width: 248px; z-index: 2; box-shadow: var(--rd-shadow-pop); }

  /* --- floating things ---------------------------------------------------------------------------------------------- */
  .find {
    position: absolute; top: 10px; right: 14px; z-index: 4; display: flex; align-items: center; gap: 2px;
    padding: 4px 4px 4px 10px; background: var(--rd-raised); border: 1px solid var(--rd-rule-strong);
    border-radius: var(--mn-radius-md, 8px); box-shadow: var(--rd-shadow-pop);
  }
  .find input { width: 200px; border: 0; outline: none; background: transparent; font: inherit; color: var(--rd-ink); }
  .find .count { color: var(--rd-quiet); font-size: var(--mn-text-xs, 12px); min-width: 5.5em; text-align: right; padding-right: 4px; font-variant-numeric: tabular-nums; }

  .pop {
    position: absolute; z-index: 5; display: flex; align-items: center; gap: 2px; padding: 4px;
    background: var(--rd-ink); color: var(--rd-paper);
    border-radius: 10px; box-shadow: var(--rd-shadow-pop); transform: translate(-50%, calc(-100% - 10px));
  }
  .pop[data-below] { transform: translate(-50%, 12px); }
  .pop .swatch { width: 26px; height: 26px; border: 0; background: transparent; border-radius: 50%; display: grid; place-items: center; cursor: pointer; }
  .pop .swatch i { width: 15px; height: 15px; border-radius: 50%; display: block; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35); }
  .pop .swatch[aria-pressed='true'] i { box-shadow: 0 0 0 2px var(--rd-paper); }
  .pop .swatch[data-color='yellow'] i { background: rgb(250, 204, 21); }
  .pop .swatch[data-color='green'] i { background: rgb(74, 200, 120); }
  .pop .swatch[data-color='blue'] i { background: rgb(86, 156, 245); }
  .pop .swatch[data-color='pink'] i { background: rgb(240, 110, 170); }
  .pop .act { height: 28px; padding: 0 9px; border: 0; background: transparent; color: inherit; border-radius: 7px; cursor: pointer; }
  .pop .act:hover, .pop .swatch:hover { background: color-mix(in srgb, var(--rd-paper) 16%, transparent); }
  .pop .vsep { width: 1px; height: 18px; background: color-mix(in srgb, var(--rd-paper) 28%, transparent); margin: 0 3px; }

  .composer {
    position: absolute; z-index: 5; width: 300px; padding: 10px; display: grid; gap: 8px;
    background: var(--rd-raised); border: 1px solid var(--rd-rule-strong); border-radius: var(--mn-radius-md, 8px); box-shadow: var(--rd-shadow-pop);
  }
  .composer q { font-family: var(--rd-face); color: var(--rd-muted); font-size: 0.95em; quotes: '“' '”'; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .composer textarea {
    width: 100%; min-height: 76px; resize: vertical; font: inherit; color: var(--rd-ink); line-height: 1.45;
    padding: 7px 8px; border: 1px solid var(--rd-rule-strong); border-radius: var(--mn-radius-sm, 4px); background: var(--rd-paper);
  }
  .composer .row { display: flex; justify-content: flex-end; gap: 6px; align-items: center; }
  .composer .row .grow { flex: 1; color: var(--rd-quiet); font-size: var(--mn-text-xs, 12px); }
  .primary {
    height: 28px; padding: 0 12px; border: 0; border-radius: var(--mn-radius-control, 6px); cursor: pointer;
    background: var(--mn-color-action-primary, var(--rd-accent)); color: var(--mn-color-text-on-accent, #fff);
  }
  .primary:disabled { opacity: 0.5; cursor: default; }

  .menu {
    position: absolute; z-index: 6; min-width: 210px; padding: 6px; display: grid; gap: 2px;
    background: var(--rd-raised); border: 1px solid var(--rd-rule-strong); border-radius: var(--mn-radius-md, 8px); box-shadow: var(--rd-shadow-pop);
  }
  .menu button { text-align: left; height: 30px; padding: 0 10px; border: 0; border-radius: var(--mn-radius-sm, 4px); background: transparent; cursor: pointer; color: var(--rd-ink); }
  .menu button:hover { background: var(--rd-hover); }
  .menu .label { padding: 6px 10px 2px; color: var(--rd-quiet); font-size: var(--mn-text-xs, 12px); }
  .menu .choices { display: flex; gap: 4px; padding: 2px 6px 6px; }
  .menu .choices button { flex: 1; text-align: center; border: 1px solid var(--rd-rule); }
  .menu .choices button[aria-pressed='true'] { border-color: var(--rd-accent); color: var(--rd-accent); background: var(--rd-pressed); }

  .banner {
    position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 3; max-width: min(560px, 90%);
    padding: 8px 14px; border-radius: 999px; background: var(--rd-raised); border: 1px solid var(--rd-rule-strong);
    color: var(--rd-muted); box-shadow: var(--rd-shadow-pop); font-size: var(--mn-text-xs, 12px); text-align: center;
  }
  .veil { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; background: var(--rd-canvas); color: var(--rd-muted); padding: 24px; text-align: center; }
  .veil p { max-width: 36em; line-height: 1.5; }

  @container reader (max-width: 640px) {
    .zoom { display: none; }
    .loc .where, .loc-slot .where { max-width: 9em; }
  }
`
