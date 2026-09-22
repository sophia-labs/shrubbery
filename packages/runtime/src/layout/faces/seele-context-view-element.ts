/**
 * seele-context-view-element.ts — `<sh-seele-context-view>`, the body of the
 * `seele.context` face (W8.1's stub mount, per the 2026-08-03 ratification).
 *
 * It renders exactly what v1 can produce and nothing it cannot:
 *   - the wax-seal chip, over the five-state-max `DriftState` (W9.1b / D18);
 *   - the diagnostics list, when the compiler refused;
 *   - the declared-object COUNT and the compiler's identity when it sealed.
 *
 * Deliberately NOT here: the per-class card model (W8.2), completions (W8.3),
 * cursor coupling (W8.4), the declared-object picker (W8.5), and the apply
 * affordance (W9.4/W14.8). Each is its own workstream with its own oracle;
 * a stub that faked any of them would be worse than an empty region.
 *
 * FORBIDDEN DEPICTIONS (W9.3), enforced structurally rather than by review:
 * `chipClass`/`chipLabel` below switch EXHAUSTIVELY over `DriftState['kind']`,
 * so there is no arm in which a durability glyph or a warning tier could be
 * written, and adding a sixth state to the union fails the build here.
 *
 * THE BODY IS SEAL-GATED (tranche-1 finding A). `renderBody` switches on
 * `seal.kind`, never on the report alone: a `contractHash` and a declared-
 * object count render ONLY under a `sealed` seal, and the diagnostics list
 * ONLY under `refused` — both of which `deriveDriftState` grants exclusively
 * to a report about the exact bytes on screen. During `typing`/`compiling`/
 * `drifted` the previous verdict may appear ONLY explicitly labelled as being
 * about older bytes. A stale hash presented as current is the lie this gate
 * exists to make unrepresentable.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import type { DriftState } from '../../seele/drift-state.js'
import { describeDriftState } from '../../seele/drift-state.js'
import { countCompileErrors, type SeeleCompileReport } from '../../seele/compile-seam.js'
import type { SeeleWorkbenchSnapshot } from '../../seele/workbench-controller.js'

/** The chip's colour class — one per state, no durability arm, no warning arm. */
function chipClass(state: DriftState): string {
  switch (state.kind) {
    case 'typing':
      return 'chip chip-typing'
    case 'compiling':
      return 'chip chip-compiling'
    case 'sealed':
      return 'chip chip-sealed'
    case 'refused':
      return 'chip chip-refused'
    case 'drifted':
      return 'chip chip-drifted'
  }
}

@customElement('sh-seele-context-view')
export class ShSeeleContextView extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      overflow: auto;
      box-sizing: border-box;
      padding: var(--mn-space-3, 12px);
      background: var(--mn-color-surface-sunken, var(--mn-color-surface-base));
      color: var(--mn-color-text-primary);
      font: var(--mn-text-sm, 13px) / 1.5 var(--mn-font-chrome, system-ui, sans-serif);
    }
    :host(:focus-visible) {
      outline: 2px solid var(--mn-focus-ring-color);
      outline-offset: -2px;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-3, 12px);
    }
    .contract {
      color: var(--mn-color-text-muted);
      font-size: var(--mn-text-xs, 12px);
      font-weight: 600;
      font-variant-caps: all-small-caps;
      letter-spacing: var(--mn-tracking-label, 0.05em);
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border: 1px solid var(--mn-color-border-strong, #bdb7aa);
      border-radius: 999px;
      font-size: var(--mn-text-xs, 12px);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .chip-sealed {
      border-color: var(--mn-color-accent, #35644c);
      color: var(--mn-color-accent, #35644c);
    }
    .chip-refused {
      border-color: var(--mn-color-danger, #a33);
      color: var(--mn-color-danger, #a33);
    }
    .chip-drifted,
    .chip-typing,
    .chip-compiling {
      color: var(--mn-color-text-muted);
    }
    .hash {
      display: block;
      overflow-wrap: anywhere;
      margin-bottom: var(--mn-space-3, 12px);
      color: var(--mn-color-text-tertiary);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
      user-select: all;
    }
    .note {
      margin: 0 0 var(--mn-space-2, 8px);
      color: var(--mn-color-text-muted);
    }
    .problem {
      margin: 0 0 var(--mn-space-2, 8px);
      color: var(--mn-color-danger, #a33);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      padding: 6px 0;
      border-top: 1px solid var(--mn-color-border-subtle, #e2ded4);
    }
    .code {
      color: var(--mn-color-text-tertiary);
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-size: var(--mn-text-xs, 12px);
    }
  `

  /** The contract this pane is a workbench for — `paramsSchema`'s `contractName`. */
  @property({ type: String, attribute: false })
  contractName = ''

  /** The controller's latest snapshot. Never mutated here. */
  @property({ attribute: false })
  snapshot: SeeleWorkbenchSnapshot | null = null

  /**
   * The body lives inside an explicit `<section>` rather than sitting directly
   * in the template's top-level fragment. That is not cosmetic: happy-dom
   * (15.11.7, the environment every vitest suite in this repo runs in)
   * mis-parses Lit's `<?>` child-part marker when it appears in the fragment
   * root immediately after a closing tag — it escapes it to the literal text
   * `&lt;?&gt;` and the nested template silently never renders. Reproduced with
   * a bare four-line Lit element, so it is the environment, not this file.
   * Inside an element the same binding parses correctly.
   */
  render(): TemplateResult {
    const snapshot = this.snapshot
    const seal = snapshot?.seal ?? null
    return html`
      <header>
        <span class="contract">${this.contractName || 'seele'}</span>
        ${seal
          ? html`<span class=${chipClass(seal)} data-seal-state=${seal.kind} role="status"
              >${describeDriftState(seal)}</span
            >`
          : nothing}
      </header>
      <section class="body">${this.renderBody(snapshot)}</section>
    `
  }

  private renderBody(snapshot: SeeleWorkbenchSnapshot | null): TemplateResult {
    if (!snapshot) return html`<p class="note" data-empty="no-controller">No report yet.</p>`
    if (snapshot.sourceError) {
      return html`<p class="problem" data-source-error>${snapshot.sourceError}</p>`
    }
    if (snapshot.compileError) {
      return html`<p class="problem" data-compile-error>${snapshot.compileError}</p>`
    }
    const seal = snapshot.seal
    const report = snapshot.report
    if (!report || !seal) return html`<p class="note" data-empty="no-report">No report yet.</p>`

    // The gate: only the seal — which `deriveDriftState` grants exclusively to
    // a report about the exact bytes on screen — may put a verdict in the body.
    switch (seal.kind) {
      case 'sealed':
        return html`
          <span class="hash" data-contract-hash>${report.contractHash ?? ''}</span>
          <p class="note" data-declared-count=${report.declaredObjects.length}>
            ${report.declaredObjects.length} declared
            ${report.declaredObjects.length === 1 ? 'object' : 'objects'} · ${report.tripleCount} triples ·
            ${report.producer} ${report.compilerVersion}
          </p>
        `
      case 'refused':
        return html`
          <ul data-diagnostics aria-label="compile diagnostics">
            ${report.diagnostics.map(
              diagnostic => html`
                <li data-diagnostic-severity=${diagnostic.severity}>
                  <div>${diagnostic.message}</div>
                  <div class="code">${diagnostic.code} · ${diagnostic.anchor}</div>
                </li>
              `,
            )}
          </ul>
        `
      case 'typing':
      case 'compiling':
      case 'drifted':
        return this.renderStaleBody(seal.kind, report)
    }
  }

  /**
   * The pending/drifted body (tranche-1 findings A+B): the report on hand is
   * about OLDER bytes than the ones on screen, so it never renders as current
   * — no `[data-contract-hash]` element, no declared-object count. What it
   * WAS is shown only under an explicit older-bytes label, hash-prefixed the
   * same way the chip is, never the full selectable hash.
   */
  private renderStaleBody(
    kind: 'typing' | 'compiling' | 'drifted',
    report: SeeleCompileReport,
  ): TemplateResult {
    const errorCount = countCompileErrors(report)
    const previous =
      report.clean && report.contractHash !== null
        ? `sealed ${report.contractHash.slice(0, 12)}`
        : report.clean
          ? 'unverifiable (clean but hashless)'
          : `refused — ${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`
    return html`
      <p class="note" data-awaiting-verdict=${kind}>No verdict for the current bytes yet.</p>
      <p class="note" data-stale-verdict>Previous verdict — older bytes: ${previous}</p>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sh-seele-context-view': ShSeeleContextView
  }
}
