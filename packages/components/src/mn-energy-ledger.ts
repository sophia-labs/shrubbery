/**
 * mn-energy-ledger — an Ariadne World's energy ledger, shown honestly.
 *
 * A render receipt states, per World, the work that went in (source work, the
 * hands' control work) and where it went (internal loss, radiation), with the
 * closure residual the World's own bookkeeping leaves. The numbers are the
 * World's own state units, which the receipt calls joules (they are not
 * calibrated against a measured instrument), and the element says so. A ledger
 * closes when work in = internal loss + radiation + the World's stored change,
 * to the closure residual. This element shows those
 * numbers as they are stated: each with its unit and an SI prefix to four
 * significant figures, the exact stated value on hover and in `data-exact`, an
 * em dash for anything not stated (never a zero). What it computes is only
 * arithmetic on the stated parts (the shares of the work in, the residual as a
 * fraction of it), and it says so.
 *
 * Controlled and backend-free: `ledgers` in, nothing out.
 */

import { LitElement, css, html, nothing, type TemplateResult } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { SkinAware } from './skin-aware.js'
import { formatQuantity, ledgerBalance, type MnEnergyLedger } from './audio-visuals.js'

const ROWS: ReadonlyArray<{ key: keyof MnEnergyLedger; label: string; role: 'in' | 'out' | 'check' }> = [
  { key: 'sourceWork', label: 'Source work', role: 'in' },
  { key: 'controlWork', label: 'Control work', role: 'in' },
  { key: 'internalLoss', label: 'Internal loss', role: 'out' },
  { key: 'radiation', label: 'Radiation', role: 'out' },
  { key: 'closureResidual', label: 'Closure residual', role: 'check' },
  { key: 'maxFrameResidual', label: 'Largest frame residual', role: 'check' },
]

const COUNTS: ReadonlyArray<{ key: keyof MnEnergyLedger; one: string; many: string }> = [
  { key: 'plucks', one: 'pluck', many: 'plucks' },
  { key: 'hammerOns', one: 'hammer-on', many: 'hammer-ons' },
  { key: 'pullOffs', one: 'pull-off', many: 'pull-offs' },
  { key: 'slides', one: 'slide', many: 'slides' },
]

function percent(x: number): string {
  const p = x * 100
  if (p === 0) return '0%'
  if (Math.abs(p) >= 10) return `${p.toFixed(1)}%`
  if (Math.abs(p) >= 0.1) return `${p.toFixed(2)}%`
  return `${p.toPrecision(2)}%`
}

function ratio(x: number): string {
  if (x === 0) return '0'
  const [m, e] = x.toExponential(1).split('e')
  return `${m} × 10${superscript(Number(e))}`
}

function superscript(n: number): string {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
  return String(n).split('').map((c) => map[c] ?? c).join('')
}

@customElement('mn-energy-ledger')
export class MnEnergyLedgerElement extends SkinAware(LitElement) {
  static styles = css`
    :host {
      display: block;
      color: var(--mn-color-text-primary, #1f2a24);
      font-family: var(--mn-font-sans, system-ui, sans-serif);
      container-type: inline-size;
    }
    .world + .world {
      margin-top: var(--mn-space-4, 16px);
      padding-top: var(--mn-space-4, 16px);
      border-top: 1px solid var(--mn-color-border-subtle, #e5e7eb);
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: var(--mn-space-1, 4px) var(--mn-space-2, 8px);
      margin-bottom: var(--mn-space-2, 8px);
    }
    .name {
      font-weight: var(--mn-font-weight-medium, 560);
    }
    .anatomy,
    .unitnote {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.8125rem;
    }
    dl {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2px var(--mn-space-3, 12px);
      margin: 0;
    }
    .row {
      display: contents;
    }
    dt {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    dt::before {
      content: '';
      flex: 0 0 auto;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      background: var(--swatch, transparent);
      border: 1px solid var(--swatch-border, var(--mn-color-border-default, #d1d5db));
    }
    .row[data-role='in'] dt { --swatch: var(--mn-color-accent, #4a8b6f); --swatch-border: transparent; }
    .row[data-key='internalLoss'] dt { --swatch: var(--mn-chart-categorical-2, #c75b39); --swatch-border: transparent; }
    .row[data-key='radiation'] dt { --swatch: var(--mn-chart-categorical-3, #7b61c9); --swatch-border: transparent; }
    dd {
      margin: 0;
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
      font-size: 0.875rem;
      text-align: right;
      white-space: nowrap;
    }
    .unit {
      color: var(--mn-color-text-secondary, #4b5563);
      margin-left: 0.25em;
    }
    .absent {
      color: var(--mn-color-text-muted, #9ca3af);
    }
    .balance {
      display: flex;
      height: 8px;
      margin: var(--mn-space-3, 12px) 0 var(--mn-space-1, 4px);
      border-radius: var(--mn-radius-full, 999px);
      overflow: hidden;
      background: var(--mn-color-surface-sunken, #f3f4f6);
    }
    .balance span {
      display: block;
      min-width: 0;
    }
    .balance .loss { background: var(--mn-chart-categorical-2, #c75b39); }
    .balance .radiation { background: var(--mn-chart-categorical-3, #7b61c9); }
    .balance .difference { background: var(--mn-color-text-muted, #9ca3af); }
    .prose {
      margin: var(--mn-space-1, 4px) 0 0;
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.8125rem;
      line-height: 1.45;
    }
    .counts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: var(--mn-space-2, 8px);
      padding: 0;
      list-style: none;
    }
    .counts li {
      font-family: var(--mn-font-mono, ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
      font-size: 0.75rem;
      padding: 2px 8px;
      border-radius: var(--mn-radius-full, 999px);
      background: var(--mn-color-surface-sunken, #f3f4f6);
      color: var(--mn-color-text-secondary, #4b5563);
    }
    .empty {
      color: var(--mn-color-text-secondary, #4b5563);
      font-size: 0.875rem;
      margin: 0;
    }
  `

  /** One ledger per World of the render, as the receipt states them. */
  @property({ attribute: false }) ledgers: readonly MnEnergyLedger[] = []
  /** Hide the shares bar and its sentence (for tight spaces). */
  @property({ type: Boolean }) compact = false
  /** What to say when there is no ledger. */
  @property({ type: String }) empty = 'No energy ledger is stated for this render.'

  private quantity(ledger: MnEnergyLedger, key: keyof MnEnergyLedger): TemplateResult {
    const raw = ledger[key]
    const q = typeof raw === 'number' ? formatQuantity(raw, 'J') : null
    if (!q) return html`<dd class="absent" data-exact="">—</dd>`
    return html`<dd title=${q.exact} data-exact=${q.exact}><span class="num">${q.value}</span><span class="unit">${q.unit}</span></dd>`
  }

  private world(ledger: MnEnergyLedger): TemplateResult {
    const balance = ledgerBalance(ledger)
    const counts = COUNTS.filter(({ key }) => typeof ledger[key] === 'number')
    return html`<section class="world" data-world=${ledger.world}>
      <header>
        <span class="name">World ${ledger.world}</span>
        ${ledger.anatomy ? html`<span class="anatomy">${ledger.anatomy}</span>` : nothing}
        <span class="unitnote" title="The receipt calls them joules; they are not calibrated against a measured instrument.">the receipt's joules: the World's own units</span>
      </header>
      <dl>
        ${ROWS.map(({ key, label, role }) => html`<div class="row" data-key=${key} data-role=${role}>
          <dt>${label}</dt>${this.quantity(ledger, key)}
        </div>`)}
      </dl>
      ${balance && !this.compact
        ? html`<div
              class="balance"
              role="img"
              aria-label=${`Of the work in: ${percent(balance.shares.internalLoss)} internal loss, ${percent(balance.shares.radiation)} radiation, ${percent(balance.shares.difference)} the World's stored change`}
            >
              <span class="loss" style=${`flex: ${Math.max(0, balance.shares.internalLoss)} 1 0`}></span>
              <span class="radiation" style=${`flex: ${Math.max(0, balance.shares.radiation)} 1 0`}></span>
              <span class="difference" style=${`flex: ${Math.max(0, balance.shares.difference)} 1 0`}></span>
            </div>
            <p class="prose" data-computed="balance">${`Of the work in (${formatQuantity(balance.workIn, 'J')?.text}), ${percent(balance.shares.internalLoss)} went to internal loss, ${percent(balance.shares.radiation)} was radiated and ${percent(balance.shares.difference)} is the World's stored change${balance.residualRatio !== null ? `; the closure residual is ${ratio(balance.residualRatio)} of the work in` : ''}. Computed here from the stated parts.`}</p>`
        : nothing}
      ${counts.length > 0
        ? html`<ul class="counts" aria-label="Touches">
            ${counts.map(({ key, one, many }) => {
              const n = ledger[key] as number
              return html`<li data-key=${key}>${n} ${n === 1 ? one : many}</li>`
            })}
          </ul>`
        : nothing}
    </section>`
  }

  render() {
    if (this.ledgers.length === 0) return html`<p class="empty">${this.empty}</p>`
    return html`<div class="worlds">${this.ledgers.map((ledger) => this.world(ledger))}</div>`
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mn-energy-ledger': MnEnergyLedgerElement
  }
}
