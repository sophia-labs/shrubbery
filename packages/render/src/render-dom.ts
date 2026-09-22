import { formatTimestamp } from '@shrubbery/nucleus'
import { CONTENT_TYPE, type KindedValueNode, type RenderCtx, type RenderedResource, type Resource } from './target.js'
import { linksFor } from './links.js'

function assertNever(value: never): never {
  throw new Error(`Unhandled render resource kind: ${JSON.stringify(value)}`)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Display strings come ONLY from the shared deterministic-UTC formatter (R4c). */
function timeLabel(ms: number): string {
  return formatTimestamp(ms)
}

function kindedValueContent(node: KindedValueNode): string {
  const value = escapeHtml(node.label ?? node.value)
  switch (node.kind) {
    case 'reference':
      return node.href
        ? `<a class="mn-kind-link" href="${escapeHtml(node.href)}">${value}</a>`
        : `<span class="mn-kind-value">${value}</span>`
    case 'metric':
      return `<span class="mn-kind-value">${escapeHtml(node.value)}</span>${
        node.unit ? `<span class="mn-kind-unit">${escapeHtml(node.unit)}</span>` : ''
      }`
    case 'testimony': {
      const observer = node.attribution?.observer
      const observedAt = node.attribution?.observedAt
      const hasObservedAt = observedAt !== undefined
      const suffix = observer || hasObservedAt
        ? `<span class="mn-kind-attribution">${observer ? escapeHtml(observer) : ''}${observer && hasObservedAt ? ', ' : ''}${hasObservedAt ? timeLabel(observedAt) : ''}</span>`
        : ''
      return `<span class="mn-kind-value">${value}</span>${suffix}`
    }
    case 'identity':
    case 'state':
    case 'prose':
    case 'affordance':
      return `<span class="mn-kind-value">${value}</span>`
    default:
      return assertNever(node.kind)
  }
}

/**
 * The data-kind attribute convention is THE kind discriminator (R4b): kind.css
 * selects `.mn-kind[data-kind=…]` and nothing else. The structural CHILD classes
 * (mn-kind-value / mn-kind-unit / mn-kind-link / mn-kind-attribution) are not
 * kind discriminators and stay; per-kind `mn-kind-{kind}` classes are gone.
 */
function kindedValueHtml(node: KindedValueNode): string {
  // node.stance is now the closed `Stance` union (5 members, incl. 'contested')
  // rather than `string` — no behavioural change here: data-stance is stamped
  // verbatim either way. Escaping stays even though the union is closed —
  // defense in depth (WS1 S1).
  const attrs = [
    'class="mn-kind"',
    `data-kind="${node.kind}"`,
    node.stance ? `data-stance="${escapeHtml(node.stance)}"` : '',
  ].filter(Boolean).join(' ')
  return `<span ${attrs}>${kindedValueContent(node)}</span>`
}

export function renderDom(resource: Resource, ctx: RenderCtx): RenderedResource {
  const links = linksFor(resource, 'dom', ctx)
  let body: string
  switch (resource.kind) {
    case 'kinded-value':
      body = kindedValueHtml(resource.node)
      break
    case 'catalog':
    case 'component':
    case 'workspace':
    case 'vocab-catalog':
    case 'vocab-pack':
    case 'mem-plot':
    case 'mem-subject':
    case 'mem-bouquet':
    case 'walk-index':
    case 'walk-run':
    case 'tn-knob':
    case 'tn-greenhouse':
    case 'flow-board':
      // flow-board's DOM face is the React Flow island (FLOW-EF-9, carried,
      // apps/flow) — never a pure DOM string; 1b's registry-level non-DOM
      // path stays deferred to wave two.
      throw new Error(
        "renderDom: only the render-layer 'kinded-value' carrier has a pure DOM-string face; Lit resources remain delegated to @shrubbery/runtime.",
      )
    default:
      assertNever(resource)
  }
  return { body, contentType: CONTENT_TYPE.dom, links }
}
