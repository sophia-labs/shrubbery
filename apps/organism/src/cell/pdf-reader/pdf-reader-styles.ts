/** The reader's own styles (light DOM, scoped by the tag). House tokens only, so every skin dresses it. pdf.js's viewer CSS is injected beside it. */
export const PDF_READER_CSS = `
mn-pdf-reader {
  --pr-bg: var(--mn-color-surface-base, #fff);
  --pr-sunken: var(--mn-color-surface-sunken, #eef0ee);
  --pr-line: var(--mn-color-border-subtle, #e1e7e3);
  --pr-line-strong: var(--mn-color-border-default, #c9d2cc);
  --pr-ink: var(--mn-color-text-primary, #222a25);
  --pr-ink2: var(--mn-color-text-secondary, #4d5952);
  --pr-ink3: var(--mn-color-text-muted, #768079);
  --pr-accent: var(--mn-color-text-accent, #2e6a4f);
  --pr-hover: var(--mn-color-surface-hover, #f1f3f1);
  --pr-read: var(--mn-color-info, #2f6fb0);
  --pr-check: var(--mn-color-warning, #b87a00);
  --pr-checked: var(--mn-color-success, #2e7d4f);
  --pr-corrected: #7a4fb0;
  --pr-contested: var(--mn-color-danger, #b3261e);
  display: flex; flex-direction: column; min-width: 0; min-height: 0; width: 100%; height: 100%;
  container-type: inline-size; container-name: pdfr;
  color: var(--pr-ink); background: var(--pr-sunken); font: var(--mn-text-sm, 13px) / 1.35 var(--mn-font-chrome, system-ui, sans-serif);
  position: relative; overflow: hidden;
}
mn-pdf-reader[hidden] { display: none; }
mn-pdf-reader button { font: inherit; color: inherit; }
mn-pdf-reader .pr-bar { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 40px; padding: 4px 10px; box-sizing: border-box;
  background: var(--pr-bg); border-bottom: 1px solid var(--pr-line); overflow-x: auto; scrollbar-width: none; }
mn-pdf-reader .pr-bar::-webkit-scrollbar { display: none; }
mn-pdf-reader .pr-sep { flex: 0 0 1px; align-self: stretch; margin: 6px 4px; background: var(--pr-line); }
mn-pdf-reader .pr-grow { flex: 1 1 auto; }
mn-pdf-reader .pr-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 0 0 auto; min-width: 28px; height: 28px; padding: 0 6px;
  border: 1px solid transparent; border-radius: var(--mn-radius-md, 6px); background: transparent; cursor: pointer; color: var(--pr-ink2); white-space: nowrap; }
mn-pdf-reader .pr-btn:hover:not(:disabled) { background: var(--pr-hover); color: var(--pr-ink); }
mn-pdf-reader .pr-btn:disabled { opacity: 0.4; cursor: default; }
mn-pdf-reader .pr-btn[aria-pressed='true'] { background: var(--mn-color-surface-accent, #e3efe8); color: var(--pr-accent); border-color: var(--pr-line-strong); }
mn-pdf-reader .pr-btn:focus-visible, mn-pdf-reader input:focus-visible, mn-pdf-reader select:focus-visible, mn-pdf-reader .pr-item:focus-visible,
mn-pdf-reader .pr-thumb:focus-visible, mn-pdf-reader .pr-abox:focus-visible { outline: 2px solid var(--mn-color-border-focus, var(--pr-accent)); outline-offset: 1px; }
mn-pdf-reader .pr-btn svg { width: 16px; height: 16px; flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
mn-pdf-reader .pr-page { display: inline-flex; align-items: center; gap: 4px; color: var(--pr-ink3); flex: 0 0 auto; }
mn-pdf-reader .pr-page input { width: 3.2em; height: 26px; box-sizing: border-box; text-align: center; border: 1px solid var(--pr-line-strong); border-radius: var(--mn-radius-md, 6px);
  background: var(--pr-bg); color: var(--pr-ink); font: inherit; font-variant-numeric: tabular-nums; }
mn-pdf-reader .pr-zoom { min-width: 3.6em; font-variant-numeric: tabular-nums; }
mn-pdf-reader select.pr-fit { height: 28px; border: 1px solid transparent; border-radius: var(--mn-radius-md, 6px); background: transparent; color: var(--pr-ink2); font: inherit; cursor: pointer; }
mn-pdf-reader select.pr-fit:hover { background: var(--pr-hover); }
mn-pdf-reader .pr-main { position: relative; display: flex; flex: 1 1 auto; min-height: 0; }
mn-pdf-reader .pr-side { display: flex; flex-direction: column; flex: 0 0 auto; width: 176px; min-height: 0; background: var(--pr-bg); border-right: 1px solid var(--pr-line); }
mn-pdf-reader .pr-tabs { display: flex; flex: 0 0 auto; border-bottom: 1px solid var(--pr-line); }
mn-pdf-reader .pr-tab { flex: 1 1 0; padding: 7px 4px; border: 0; background: transparent; color: var(--pr-ink3); cursor: pointer; border-bottom: 2px solid transparent; }
mn-pdf-reader .pr-tab[aria-selected='true'] { color: var(--pr-ink); border-bottom-color: var(--pr-accent); }
mn-pdf-reader .pr-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 8px; box-sizing: border-box; }
mn-pdf-reader .pr-thumb { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; padding: 6px 4px; margin: 0 0 4px; border: 1px solid transparent; border-radius: var(--mn-radius-md, 6px);
  background: transparent; cursor: pointer; color: var(--pr-ink3); content-visibility: auto; contain-intrinsic-size: auto 180px; }
mn-pdf-reader .pr-thumb canvas { max-width: 100%; height: auto; background: #fff; box-shadow: 0 0 0 1px var(--pr-line-strong); }
mn-pdf-reader .pr-thumb .pr-ph { width: 100%; aspect-ratio: 0.77; background: var(--pr-sunken); }
mn-pdf-reader .pr-thumb[aria-current='page'] { border-color: var(--pr-accent); color: var(--pr-ink); background: var(--mn-color-surface-accent, #e3efe8); }
mn-pdf-reader .pr-outline, mn-pdf-reader .pr-outline ul { list-style: none; margin: 0; padding: 0; }
mn-pdf-reader .pr-outline ul { padding-left: 12px; }
mn-pdf-reader .pr-outline button { display: block; width: 100%; padding: 4px 6px; border: 0; background: transparent; text-align: left; border-radius: var(--mn-radius-md, 6px); cursor: pointer; color: var(--pr-ink2); overflow-wrap: anywhere; }
mn-pdf-reader .pr-outline button:hover { background: var(--pr-hover); color: var(--pr-ink); }
mn-pdf-reader .pr-note { color: var(--pr-ink3); padding: 8px; }
mn-pdf-reader .pr-stage { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; }
mn-pdf-reader .pr-container { position: absolute; inset: 0; overflow: auto; outline: none; background: var(--pr-sunken); }
mn-pdf-reader .pdfViewer { --page-bg-color: #fff; padding: 8px 0; }
mn-pdf-reader .pdfViewer .page { box-shadow: 0 1px 4px rgb(0 0 0 / 0.18); margin: 8px auto; border: 0; }
mn-pdf-reader .pdfViewer .textLayer .highlight { background-color: rgb(255 214 0 / 0.55); border-radius: 2px; }
mn-pdf-reader .pdfViewer .textLayer .highlight.selected { background-color: rgb(255 140 0 / 0.65); }
mn-pdf-reader .pr-veil { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center;
  background: color-mix(in srgb, var(--pr-sunken) 88%, transparent); color: var(--pr-ink2); }
mn-pdf-reader .pr-veil[data-error] { background: var(--pr-sunken); }
mn-pdf-reader .pr-veil p { margin: 0; max-width: 34em; }
mn-pdf-reader .pr-progress { width: min(260px, 70%); height: 4px; border-radius: 2px; background: var(--pr-line-strong); overflow: hidden; }
mn-pdf-reader .pr-progress > i { display: block; height: 100%; background: var(--pr-accent); transition: width 120ms linear; }
mn-pdf-reader .pr-progress.indeterminate > i { width: 35%; animation: pr-slide 1.1s ease-in-out infinite; }
@keyframes pr-slide { from { margin-left: -35%; } to { margin-left: 100%; } }
mn-pdf-reader .pr-banner { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); z-index: 5; max-width: calc(100% - 24px); padding: 6px 12px; border-radius: 999px;
  background: var(--pr-bg); border: 1px solid var(--pr-line-strong); color: var(--pr-ink2); box-shadow: 0 2px 8px rgb(0 0 0 / 0.12); }
mn-pdf-reader .pr-find { position: absolute; right: 14px; top: 8px; z-index: 7; display: flex; align-items: center; gap: 4px; padding: 4px 6px; background: var(--pr-bg);
  border: 1px solid var(--pr-line-strong); border-radius: var(--mn-radius-lg, 8px); box-shadow: 0 4px 14px rgb(0 0 0 / 0.16); }
mn-pdf-reader .pr-find input { width: 11em; height: 26px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--pr-line-strong); border-radius: var(--mn-radius-md, 6px); background: var(--pr-bg); color: var(--pr-ink); font: inherit; }
mn-pdf-reader .pr-find .pr-count { min-width: 5.5em; text-align: center; color: var(--pr-ink3); font-variant-numeric: tabular-nums; }
/* the assertions */
mn-pdf-reader .pr-alayer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
mn-pdf-reader .pr-abox { position: absolute; box-sizing: border-box; pointer-events: auto; cursor: pointer; border-radius: 2px; --c: var(--pr-read);
  background: color-mix(in srgb, var(--c) 18%, transparent); border: 1.5px solid var(--c); }
mn-pdf-reader .pr-abox[data-source='text'] { border-style: dashed; }
mn-pdf-reader .pr-abox[data-status='check'] { --c: var(--pr-check); }
mn-pdf-reader .pr-abox[data-status='checked'] { --c: var(--pr-checked); }
mn-pdf-reader .pr-abox[data-status='corrected'] { --c: var(--pr-corrected); }
mn-pdf-reader .pr-abox[data-status='contested'] { --c: var(--pr-contested); }
mn-pdf-reader .pr-abox:hover { background: color-mix(in srgb, var(--c) 30%, transparent); }
mn-pdf-reader .pr-abox[data-selected] { background: color-mix(in srgb, var(--c) 36%, transparent); box-shadow: 0 0 0 2px var(--c); }
mn-pdf-reader .pr-abox.flash { animation: pr-flash 1.1s ease-out 2; }
@keyframes pr-flash { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 40% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--c) 55%, transparent); } }
mn-pdf-reader .pr-card { position: absolute; z-index: 8; width: min(320px, calc(100% - 16px)); box-sizing: border-box; padding: 10px 12px; pointer-events: none; background: var(--pr-bg); color: var(--pr-ink);
  border: 1px solid var(--pr-line-strong); border-radius: var(--mn-radius-lg, 8px); box-shadow: 0 6px 22px rgb(0 0 0 / 0.2); }
mn-pdf-reader .pr-card h4 { margin: 0 0 2px; font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
mn-pdf-reader .pr-card .pr-val { font-size: 15px; font-variant-numeric: tabular-nums; margin: 2px 0 6px; }
mn-pdf-reader .pr-card dl { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr); gap: 2px 8px; margin: 0; font-size: 12px; }
mn-pdf-reader .pr-card dt { color: var(--pr-ink3); }
mn-pdf-reader .pr-card dd { margin: 0; overflow-wrap: anywhere; color: var(--pr-ink2); }
/* the list */
mn-pdf-reader .pr-claims { display: flex; flex-direction: column; flex: 0 0 auto; width: 320px; min-height: 0; background: var(--pr-bg); border-left: 1px solid var(--pr-line); }
mn-pdf-reader .pr-claims header { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 8px 10px; border-bottom: 1px solid var(--pr-line); }
mn-pdf-reader .pr-claims h3 { flex: 1 1 auto; margin: 0; font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--pr-ink2); }
mn-pdf-reader .pr-tools { display: flex; gap: 6px; padding: 8px 10px; flex: 0 0 auto; border-bottom: 1px solid var(--pr-line); }
mn-pdf-reader .pr-tools input { flex: 1 1 auto; min-width: 0; height: 26px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--pr-line-strong); border-radius: var(--mn-radius-md, 6px); background: var(--pr-bg); color: var(--pr-ink); font: inherit; }
mn-pdf-reader .pr-about { padding: 8px 10px; border-bottom: 1px solid var(--pr-line); font-size: 12px; color: var(--pr-ink2); }
mn-pdf-reader .pr-about summary { cursor: pointer; font-weight: 650; color: var(--pr-ink); overflow-wrap: anywhere; }
mn-pdf-reader .pr-about dl { display: grid; grid-template-columns: 5rem minmax(0, 1fr); gap: 2px 8px; margin: 6px 0 0; }
mn-pdf-reader .pr-about dt { color: var(--pr-ink3); } mn-pdf-reader .pr-about dd { margin: 0; overflow-wrap: anywhere; }
mn-pdf-reader .pr-about dd small { display: block; color: var(--pr-ink3); }
mn-pdf-reader .pr-about ul { margin: 6px 0 0; padding-left: 16px; }
mn-pdf-reader .pr-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 6px 10px; border-bottom: 1px solid var(--pr-line); font-size: 11px; color: var(--pr-ink3); }
mn-pdf-reader .pr-dot { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border-radius: 2px; background: color-mix(in srgb, var(--c, var(--pr-read)) 35%, transparent); border: 1.5px solid var(--c, var(--pr-read)); vertical-align: -1px; }
mn-pdf-reader .pr-dot[data-s='check'] { --c: var(--pr-check); } mn-pdf-reader .pr-dot[data-s='checked'] { --c: var(--pr-checked); }
mn-pdf-reader .pr-dot[data-s='corrected'] { --c: var(--pr-corrected); } mn-pdf-reader .pr-dot[data-s='contested'] { --c: var(--pr-contested); }
mn-pdf-reader .pr-dot[data-dashed] { border-style: dashed; }
mn-pdf-reader .pr-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 6px 12px; }
mn-pdf-reader .pr-group { margin: 8px 4px 2px; color: var(--pr-ink3); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; overflow-wrap: anywhere; }
mn-pdf-reader .pr-item { display: block; width: 100%; padding: 6px 8px; margin: 0 0 2px; border: 1px solid transparent; border-left: 3px solid var(--c, var(--pr-read)); border-radius: var(--mn-radius-md, 6px);
  background: transparent; text-align: left; cursor: pointer; content-visibility: auto; contain-intrinsic-size: auto 44px; --c: var(--pr-read); }
mn-pdf-reader .pr-item[data-status='check'] { --c: var(--pr-check); } mn-pdf-reader .pr-item[data-status='checked'] { --c: var(--pr-checked); }
mn-pdf-reader .pr-item[data-status='corrected'] { --c: var(--pr-corrected); } mn-pdf-reader .pr-item[data-status='contested'] { --c: var(--pr-contested); }
mn-pdf-reader .pr-item:hover { background: var(--pr-hover); }
mn-pdf-reader .pr-item[aria-current='true'] { background: color-mix(in srgb, var(--c) 12%, var(--pr-bg)); border-color: var(--pr-line-strong); border-left-color: var(--c); }
mn-pdf-reader .pr-row1 { display: flex; align-items: baseline; gap: 6px; }
mn-pdf-reader .pr-name { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
mn-pdf-reader .pr-name small { font-weight: 400; color: var(--pr-ink3); margin-left: 4px; font-family: var(--mn-font-mono, ui-monospace, monospace); }
mn-pdf-reader .pr-pg { flex: 0 0 auto; color: var(--pr-ink3); font-variant-numeric: tabular-nums; }
mn-pdf-reader .pr-row2 { display: flex; align-items: baseline; gap: 6px; color: var(--pr-ink2); font-variant-numeric: tabular-nums; }
mn-pdf-reader .pr-row2 .pr-v { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
mn-pdf-reader .pr-mark { flex: 0 0 auto; color: var(--pr-ink3); letter-spacing: 0.02em; }
mn-pdf-reader .pr-chip { flex: 0 0 auto; padding: 0 6px; border-radius: 999px; border: 1px solid var(--pr-line-strong); font-size: 11px; color: var(--pr-ink3); white-space: nowrap; }
mn-pdf-reader .pr-detail { margin: 6px 0 2px; padding-top: 6px; border-top: 1px dashed var(--pr-line-strong); font-size: 12px; color: var(--pr-ink2); }
mn-pdf-reader .pr-detail h5 { margin: 6px 0 2px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--pr-ink3); font-weight: 600; }
mn-pdf-reader .pr-detail ul { margin: 0; padding-left: 16px; }
mn-pdf-reader .pr-detail button { padding: 0; border: 0; background: none; color: var(--pr-accent); cursor: pointer; text-align: left; }
mn-pdf-reader .pr-detail button:hover { text-decoration: underline; }
mn-pdf-reader .pr-seam { display: flex; gap: 6px; margin-top: 6px; }
@container pdfr (max-width: 760px) {
  mn-pdf-reader .pr-claims { position: absolute; right: 0; top: 0; bottom: 0; z-index: 9; width: min(340px, 92%); box-shadow: -6px 0 18px rgb(0 0 0 / 0.18); }
  mn-pdf-reader .pr-side { position: absolute; left: 0; top: 0; bottom: 0; z-index: 9; box-shadow: 6px 0 18px rgb(0 0 0 / 0.18); }
}
@container pdfr (max-width: 520px) {
  mn-pdf-reader .pr-lbl { display: none; }
  mn-pdf-reader .pr-find { left: 8px; right: 8px; } mn-pdf-reader .pr-find input { flex: 1 1 auto; width: auto; min-width: 0; }
}
@media (prefers-reduced-motion: reduce) { mn-pdf-reader .pr-abox.flash, mn-pdf-reader .pr-progress.indeterminate > i { animation: none; } }
`
