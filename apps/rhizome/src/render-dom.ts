/**
 * render-dom.ts — the renderDomString idiom for RHIZOME.
 *
 * There is no `renderDomString` function in the codebase (it is an aspirational
 * name in @shrubbery/render comments); the real DOM face is the lifted
 * `<rz-observatory>` (THE PLOT surface), stringified via deep `.outerHTML`. This
 * module is that idiom, factored once so the conneg server, the smoke script, and
 * the smoke TEST all drive the SAME render path over the SAME live resource shapes.
 *
 * NOTE — this is the FACE-INVARIANT conneg surface: the curl-able `/plot` /
 * `/plot/{rootId}` resource is THE PLOT / THE BOUQUET content itself, so it
 * renders `<rz-observatory>` DIRECTLY (not the integrated browser shell frame —
 * the left rail + surface-switching + the cross-surface scrubber are the browser
 * app's chrome, NOT part of the curl-able resource). The browser shell composes
 * this SAME `<rz-observatory>` inside `<rz-shell>`; here we render it standalone.
 *
 * `renderPlotDomString(plot, chains)` and `renderBouquetDomString(subject)` return
 * the serialized HTML of the observatory rendered for that resource. They require a
 * DOM (happy-dom in tests, the browser in the shell) and the custom elements
 * registered (imported here as the upgrade seam). They do NOT fetch — the caller
 * hands in the LIVE resource the data layer (memory-world.ts) read from the cell.
 */

import '@shrubbery/components'
import './rz-observatory.js'
import './rz-walk.js'
import './rz-bouquet.js'
import './rz-greenhouse.js'
import type {
  BouquetResource,
  GreenhouseResource,
  KnobResource,
  MemoryRecord,
  PlotResource,
  SubjectResource,
  WalkIndexResource,
  WalkResource,
} from '@shrubbery/render'
import type { GhostCluster } from './greenhouse-views.js'
import type { RzObservatory } from './rz-observatory.js'
import type { RzWalk } from './rz-walk.js'
import type { RzBouquet } from './rz-bouquet.js'
import type { RzGreenhouse } from './rz-greenhouse.js'

/** Create + populate a standalone <rz-observatory> (THE PLOT surface); return it. */
function renderObservatory(populate: (obs: RzObservatory) => void): HTMLElement {
  const obs = document.createElement('rz-observatory') as RzObservatory
  if (!(obs instanceof HTMLElement)) {
    throw new Error('rz-observatory not registered — the upgrade seam broke')
  }
  populate(obs)
  return obs
}

/**
 * Flush every lifted element's pending Lit render. A Lit element only runs its
 * reactive lifecycle (and resolves `updateComplete`) once CONNECTED — a detached
 * container never settles. So we attach `container` to `document.body` for the
 * flush, let several passes settle (children lift during the parent's render), then
 * detach. Requires a DOM (happy-dom in tests, the browser in the shell).
 */
async function flush(container: HTMLElement): Promise<void> {
  document.body.appendChild(container)
  try {
    // Several passes: rz-observatory lifts → its mn-card/mn-graph/mn-relations lift
    // → those settle. updateComplete resolves only when connected.
    for (let pass = 0; pass < 4; pass++) {
      const els = [container, ...Array.from(container.querySelectorAll('*'))] as Array<
        HTMLElement & { updateComplete?: Promise<unknown> }
      >
      let any = false
      for (const el of els) {
        if (el.updateComplete) {
          any = true
          await el.updateComplete
        }
      }
      if (!any) break
    }
  } finally {
    container.remove()
  }
}

/** Deep HTML of an element INCLUDING its (open) shadow roots — happy-dom + browser. */
export function deepHtml(el: Element): string {
  let out = ''
  const tag = el.tagName.toLowerCase()
  const attrs = Array.from(el.attributes)
    .map((a) => ` ${a.name}="${a.value}"`)
    .join('')
  out += `<${tag}${attrs}>`
  const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot
  if (sr) {
    out += '<!--shadow-->'
    // Re-emit the component's authored styles INTO the shadow root. Lit keeps
    // `static styles` in adoptedStyleSheets (constructable sheets), which are NOT
    // element children — serializing only `sr.children` drops every component style
    // and the page renders as unstyled "black box" components. Lit exposes the
    // authored CSS on the element class as `elementStyles` (CSSResult[].cssText);
    // emit it as a <style> so the Declarative Shadow DOM is self-styled.
    const ctor = el.constructor as { elementStyles?: ReadonlyArray<{ cssText?: string }> }
    let css = ''
    if (ctor?.elementStyles?.length) {
      css = ctor.elementStyles.map((s) => s.cssText ?? '').join('\n')
    } else {
      const sheets = (sr as ShadowRoot & { adoptedStyleSheets?: ReadonlyArray<CSSStyleSheet> })
        .adoptedStyleSheets
      if (sheets) {
        for (const sh of sheets) {
          try {
            css += Array.from(sh.cssRules)
              .map((r) => r.cssText)
              .join('\n')
          } catch {
            /* unsupported in this runtime — skip */
          }
        }
      }
    }
    if (css) out += `<style>${css}</style>`
    for (const child of Array.from(sr.children)) out += deepHtml(child)
    out += '<!--/shadow-->'
  }
  for (const child of Array.from(el.children)) out += deepHtml(child)
  // include text content of leaf-ish nodes (struck soil content, bloom headlines).
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* text */) out += node.textContent ?? ''
  }
  out += `</${tag}>`
  return out
}

/**
 * Render THE PLOT for a live resource → its deep HTML string (incl. shadow DOM).
 * `ghosts` are the entity-resolution near-duplicate clusters (the MERGE-GHOST banner
 * the Plot plants); threaded so the SSR/curl Plot face shows the SAME merge affordance
 * the browser shell does (agent-native parity — the dial's consequence rendered where
 * it lives, not only as a number in the Greenhouse).
 */
export async function renderPlotDomString(
  plot: PlotResource,
  chains: ReadonlyMap<string, readonly MemoryRecord[]>,
  mintedBy: ReadonlyMap<string, string> = new Map(),
  ghosts: readonly GhostCluster[] = [],
): Promise<string> {
  const container = renderObservatory((obs) => {
    obs.plot = plot
    obs.chains = chains
    obs.mintedBy = mintedBy
    obs.ghosts = ghosts
    obs.asof = plot.asOf ?? null
    obs.openSubject = null
  })
  await flush(container)
  return deepHtml(container)
}

/** Render THE BOUQUET for a live subject → its deep HTML string (incl. shadow DOM). */
export async function renderBouquetDomString(subject: SubjectResource): Promise<string> {
  const container = renderObservatory((obs) => {
    obs.openSubject = subject
    obs.asof = subject.asOf ?? null
  })
  await flush(container)
  return deepHtml(container)
}

/**
 * Render THE CONSTELLATION READER (the rich BouquetResource bloom) → its deep HTML
 * string. This is the SAME <rz-bouquet> the browser shell drives, rendered
 * standalone for the curl-able `/bouquet/{id}` HTML face — so the curl HTML face IS
 * the in-shell constellation (one render path, no second view). Distinct from
 * renderBouquetDomString above, which renders the FLAT subject-lineage bloom inside
 * <rz-observatory> (the structural twin).
 */
export async function renderBouquetResourceDomString(bouquet: BouquetResource): Promise<string> {
  const el = document.createElement('rz-bouquet') as RzBouquet
  if (!(el instanceof HTMLElement)) {
    throw new Error('rz-bouquet not registered — the upgrade seam broke')
  }
  el.rootId = bouquet.rootId
  el.bouquet = bouquet
  el.asof = bouquet.asOf ?? null
  await flush(el)
  return deepHtml(el)
}

// ── THE WALK — the agentic-run trace as DOM (same render path as the browser) ──

/** Create + populate a standalone <rz-walk> (THE WALK surface); return it. */
function renderWalk(populate: (w: RzWalk) => void): HTMLElement {
  const w = document.createElement('rz-walk') as RzWalk
  if (!(w instanceof HTMLElement)) {
    throw new Error('rz-walk not registered — the upgrade seam broke')
  }
  populate(w)
  return w
}

/** Render THE WALK INDEX (the run list) → its deep HTML string (incl. shadow DOM). */
export async function renderWalkIndexDomString(index: WalkIndexResource): Promise<string> {
  const container = renderWalk((w) => {
    w.index = index
    w.walk = null
  })
  await flush(container)
  return deepHtml(container)
}

/** Render ONE run's WALK ribbon → its deep HTML string (incl. shadow DOM). */
export async function renderWalkRunDomString(walk: WalkResource): Promise<string> {
  const container = renderWalk((w) => {
    w.walk = walk
    w.runId = walk.id
    w.turn = walk.turnCursor ?? null
  })
  await flush(container)
  return deepHtml(container)
}

// ── THE GREENHOUSE — the cultivation knobs as DOM (same render path as the shell) ──

/**
 * Render THE GREENHOUSE for a live resource → its deep HTML string. This is the SAME
 * <rz-greenhouse> the browser shell drives, rendered standalone for the curl-able
 * `/tune` HTML face — so the curl HTML face IS the in-shell surface (one render path).
 * `ghosts` are the entity-resolution merge affordances (the merge-ghosts).
 */
export async function renderGreenhouseDomString(
  greenhouse: GreenhouseResource,
  ghosts: readonly GhostCluster[] = [],
): Promise<string> {
  const el = document.createElement('rz-greenhouse') as RzGreenhouse
  if (!(el instanceof HTMLElement)) {
    throw new Error('rz-greenhouse not registered — the upgrade seam broke')
  }
  el.greenhouse = greenhouse
  el.ghosts = ghosts
  el.asof = greenhouse.asOf ?? null
  await flush(el)
  return deepHtml(el)
}

/**
 * Render ONE KNOB → its deep HTML string. The knob's DOM face is the Greenhouse
 * surface focused on that single dial (so the knob page carries the SAME marquee /
 * meter ergonomics) — we wrap the single knob in a one-knob GreenhouseResource. The
 * marquee band is the focal knob itself when it is focal, else it renders as a row.
 */
export async function renderKnobResourceDomString(
  knob: KnobResource,
  ghosts: readonly GhostCluster[] = [],
): Promise<string> {
  const one: GreenhouseResource = {
    kind: 'tn-greenhouse',
    id: 'greenhouse',
    title: `Rhizome — ${knob.title}`,
    summary: knob.summary,
    asOf: knob.asOf ?? null,
    knobs: [knob],
  }
  return renderGreenhouseDomString(one, ghosts)
}
