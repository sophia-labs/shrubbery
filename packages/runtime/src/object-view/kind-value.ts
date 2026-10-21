/**
 * The kinded value markup and its shadow-scoped styles, shared by every object card: `<sh-object-card-view>`
 * (`card.object`) and `<sh-object-view>` (the typed-object face). One rendering of a field's value, so the two cards
 * converge instead of forking (typed objects architecture D7).
 *
 * `.mn-kind[data-kind=…]` markup does NOT light the global `kind.css` inside a shadow root (selectors never cross a
 * shadow boundary; only inherited custom PROPERTY VALUES do), so these styles reproduce, token-driven against the SAME
 * `--mn-kind-*` custom properties `kind.css` defines, every kind a card emits. `object-card-kind-parity.test.ts`
 * guards this duplication against drift, for both elements.
 */

import type { DisplayKind } from '@shrubbery/nucleus'
import { css, html, nothing, type TemplateResult } from 'lit'

export const OBJECT_KIND_STYLES = css`
  .mn-kind {
    color: var(--mn-kind-text);
  }
  .mn-kind[data-kind='identity'] {
    --mn-kind-register-current: identity;
    font-weight: 650;
  }
  .mn-kind[data-kind='state'] {
    --mn-kind-register-current: state;
    color: var(--mn-kind-muted);
  }
  .mn-kind[data-kind='metric'] {
    --mn-kind-register-current: metric;
  }
  .mn-kind[data-kind='metric'] .mn-kind-value {
    font-variant-numeric: tabular-nums;
    font-weight: 650;
  }
  .mn-kind[data-kind='metric'] .mn-kind-unit {
    color: var(--mn-kind-metric-unit);
    margin-inline-start: 0.25rem;
  }
  .mn-kind[data-kind='prose'] {
    --mn-kind-register-current: prose;
    line-height: 1.55;
  }
  .mn-kind[data-kind='reference'] {
    --mn-kind-register-current: reference;
  }
  .mn-kind[data-kind='reference'] .mn-kind-link {
    color: var(--mn-kind-reference-text);
    text-decoration-color: color-mix(in srgb, var(--mn-kind-reference-text) 45%, transparent);
    text-underline-offset: 0.14em;
  }
  .mn-kind[data-kind='testimony'] .mn-kind-attribution {
    color: var(--mn-kind-testimony-text);
    margin-inline-start: 0.4rem;
  }
  .mn-kind[data-kind='testimony'] {
    --mn-kind-register-current: testimony;
  }
  .mn-kind[data-kind='testimony'] .mn-kind-attribution::before {
    content: '— ';
  }
  .mn-kind[data-kind='affordance'] {
    --mn-kind-register-current: affordance;
    color: var(--mn-kind-accent);
    font-weight: 600;
  }
`

/** One value, wearing its kind: a link for a reference, a figure and its unit for a metric, plain text otherwise. */
export function kindValue(
  text: string,
  kind: DisplayKind,
  opts: { readonly unit?: string; readonly href?: string; readonly title?: string } = {},
): TemplateResult {
  if (kind === 'reference' && opts.href) {
    return html`<span class="mn-kind" data-kind="reference" title=${opts.title ?? nothing}
      ><a class="mn-kind-link" href=${opts.href}>${text}</a></span
    >`
  }
  if (kind === 'metric') {
    return html`<span class="mn-kind" data-kind="metric" title=${opts.title ?? nothing}
      ><span class="mn-kind-value">${text}</span
      >${opts.unit ? html`<span class="mn-kind-unit">${opts.unit}</span>` : nothing}</span
    >`
  }
  return html`<span class="mn-kind" data-kind=${kind} title=${opts.title ?? nothing}
    ><span class="mn-kind-value">${text}</span></span
  >`
}
