/**
 * Hoja's MUS mode, coloured from house tokens: the grammar's `hljs-*` scopes inside the ```mus fence, and the
 * checker's marks (`hoja-diag`) and margin notes (`hoja-diag-note`). Scoped to `hoja-mus-editor` so nothing else changes.
 */
import { css } from 'lit'

export const musEditorStyles = css`
  hoja-mus-editor {
    display: block;
    min-width: 0;
    /* A score page is a working sheet, not a manuscript: less margin, no half-screen minimum. */
    --mn-editor-sheet-padding: 1.75rem clamp(0.5rem, 3vw, 2rem) 2rem;
  }
  hoja-mus-editor hoja-editor { display: block; }
  hoja-mus-editor hoja-editor[posture='page'] .hoja-editor__content { min-block-size: 0; }
  /* A score's bar lines are long: wrap them (at spaces, then anywhere) so the whole bar and its notes stay in view. */
  hoja-mus-editor hoja-editor .hoja-editor__mount .ProseMirror pre {
    font-family: var(--mn-font-mono, ui-monospace, 'SF Mono', Menlo, monospace);
    font-size: var(--hoja-mus-font-size, 0.84rem);
    line-height: 1.6;
    tab-size: 4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow-x: hidden;
  }
  hoja-mus-editor .hljs-keyword { color: var(--mn-color-text-accent, #2e6a4f); font-weight: 600; }
  hoja-mus-editor .hljs-title { color: var(--mn-color-text-link, var(--mn-color-accent, #39765a)); font-weight: 600; }
  hoja-mus-editor .hljs-type { color: var(--mn-color-text-accent-strong, var(--mn-color-text-accent, #2e6a4f)); }
  hoja-mus-editor .hljs-number { color: var(--mn-color-text-warning, var(--mn-color-warning, #9a6400)); }
  hoja-mus-editor .hljs-built_in { color: var(--mn-color-text-success, var(--mn-color-success, #2f7a45)); font-style: italic; }
  hoja-mus-editor .hljs-params, hoja-mus-editor .hljs-attr { color: var(--mn-color-text-secondary, #4d5952); }
  hoja-mus-editor .hljs-variable { color: var(--mn-color-text-primary, inherit); font-weight: 600; }
  hoja-mus-editor .hljs-meta { color: var(--mn-color-text-secondary, #4d5952); font-weight: 600; }
  hoja-mus-editor .hljs-string { color: var(--mn-color-text-success, var(--mn-color-success, #2f7a45)); }
  hoja-mus-editor .hljs-comment { color: var(--mn-color-text-muted, #768079); font-style: italic; }
  hoja-mus-editor .hljs-literal, hoja-mus-editor .hljs-operator, hoja-mus-editor .hljs-punctuation { color: var(--mn-color-text-muted, #768079); }

  hoja-mus-editor .hoja-diag {
    text-decoration-line: underline;
    text-decoration-style: wavy;
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
    border-radius: 2px;
  }
  hoja-mus-editor .hoja-diag--error {
    text-decoration-color: var(--mn-color-text-danger, var(--mn-color-danger, #b3261e));
    background: color-mix(in srgb, var(--mn-color-danger, #b3261e) 10%, transparent);
  }
  hoja-mus-editor .hoja-diag--warning {
    text-decoration-color: var(--mn-color-text-warning, var(--mn-color-warning, #9a6400));
    background: color-mix(in srgb, var(--mn-color-warning, #9a6400) 9%, transparent);
  }
  hoja-mus-editor .hoja-diag--info { text-decoration-color: var(--mn-color-text-muted, #768079); }
  hoja-mus-editor .hoja-diag--stale { opacity: 0.45; background: none; }
  hoja-mus-editor .hoja-diag-note {
    display: inline-block;
    margin-left: 2ch;
    padding: 0 0.6em;
    border-left: 2px solid currentColor;
    font-family: var(--mn-font-sans, system-ui, sans-serif);
    font-size: 0.86em;
    font-style: normal;
    line-height: 1.5;
    vertical-align: baseline;
    user-select: none;
    white-space: nowrap;
  }
  hoja-mus-editor .hoja-diag-note--error { color: var(--mn-color-text-danger, var(--mn-color-danger, #b3261e)); }
  hoja-mus-editor .hoja-diag-note--warning { color: var(--mn-color-text-warning, var(--mn-color-warning, #9a6400)); }
  hoja-mus-editor .hoja-diag-note--info { color: var(--mn-color-text-muted, #768079); }
`
