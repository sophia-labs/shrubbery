/**
 * Stylesheets that belong to a node view reach the root the editor actually
 * renders in.
 *
 * The editor usually lives in a SHADOW root (`<sh-editor-host>`): a `<style>`
 * appended to `document.head` never reaches it. Until 2026-09-26 the math
 * extension did exactly that, and the host re-declared what it needed (the
 * query block had the same defect and got the same fix on 2026-09-25). Here
 * a sheet is ADOPTED into the node's root — the shadow root, or the document
 * when the editor is not in one — once per root, as a constructable
 * stylesheet shared by every root in the same document.
 *
 * Adopted sheets are placed BEFORE the root's own sheets, so a host's
 * stylesheet (its theme and layout) wins a tie with a kernel default.
 */

const sheetsByDocument = new WeakMap<Document, Map<string, CSSStyleSheet>>()

type StyleRoot = (Document | ShadowRoot) & { adoptedStyleSheets?: CSSStyleSheet[] }

function styleRootOf(node: Node): StyleRoot | null {
  if (!node.isConnected) return null
  const root = node.getRootNode()
  if (root === node.ownerDocument) return root as StyleRoot
  // ShadowRoot, checked structurally (the root may come from another realm).
  if (root.nodeType === 11 && 'host' in root) return root as StyleRoot
  return null
}

function constructableSheet(doc: Document, key: string, css: string): CSSStyleSheet | null {
  const Sheet = doc.defaultView?.CSSStyleSheet
  if (!Sheet || typeof Sheet.prototype.replaceSync !== 'function') return null
  let sheets = sheetsByDocument.get(doc)
  if (!sheets) {
    sheets = new Map()
    sheetsByDocument.set(doc, sheets)
  }
  let sheet = sheets.get(key)
  if (!sheet) {
    try {
      sheet = new Sheet()
      sheet.replaceSync(css)
    } catch {
      return null
    }
    sheets.set(key, sheet)
  }
  return sheet
}

/**
 * Adopt `css` (identified by `key`) into the root `node` renders in. Returns
 * false while the node is not connected (call again once it is — see
 * `adoptEditorStylesWhenConnected`).
 */
export function adoptEditorStyles(node: Node, key: string, css: string): boolean {
  const root = styleRootOf(node)
  if (!root) return false
  const doc = node.ownerDocument ?? (root as Document)
  const sheet = Array.isArray(root.adoptedStyleSheets) ? constructableSheet(doc, key, css) : null
  if (sheet && root.adoptedStyleSheets) {
    if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [sheet, ...root.adoptedStyleSheets]
    return true
  }
  // No constructable stylesheets: a <style> at the start of the root (or head).
  const parent: ParentNode = root === doc ? doc.head : (root as ShadowRoot)
  const selector = `style[data-editor-style="${key}"]`
  if (parent.querySelector(selector)) return true
  const style = doc.createElement('style')
  style.setAttribute('data-editor-style', key)
  style.textContent = css
  parent.insertBefore(style, parent.firstChild)
  return true
}

/**
 * `adoptEditorStyles`, retried until the node is connected: node views are
 * created before ProseMirror attaches them, and an editor can be built
 * detached and mounted later. Gives up after ~60 frames.
 */
export function adoptEditorStylesWhenConnected(node: Node, key: string, css: string): void {
  if (adoptEditorStyles(node, key, css)) return
  const view = node.ownerDocument?.defaultView
  let frames = 0
  const retry = (): void => {
    if (adoptEditorStyles(node, key, css) || ++frames > 60) return
    if (view?.requestAnimationFrame) view.requestAnimationFrame(retry)
    else setTimeout(retry, 16)
  }
  queueMicrotask(retry)
}

/**
 * Horizontal scroll edges. A figure (a diagram, a long formula) wider than
 * its column scrolls sideways; `data-scroll-edges` says which sides have more
 * to see ("start", "end", "start end", or absent) so the stylesheet can fade
 * those sides out. A fade drawn as a MASK works over any content — the old
 * background-attachment shadow was painted UNDER the diagram's opaque boxes
 * and was invisible in dark mode (2026-09-26, §1 at 360px).
 */
export function updateScrollEdges(element: HTMLElement): string {
  const max = element.scrollWidth - element.clientWidth
  const edges: string[] = []
  if (max > 1) {
    const left = Math.abs(element.scrollLeft)
    if (left > 1) edges.push('start')
    if (left < max - 1) edges.push('end')
  }
  const value = edges.join(' ')
  if (value) {
    if (element.getAttribute('data-scroll-edges') !== value) element.setAttribute('data-scroll-edges', value)
  } else if (element.hasAttribute('data-scroll-edges')) {
    element.removeAttribute('data-scroll-edges')
  }
  return value
}

const edgeObservers = new WeakMap<Document, ResizeObserver>()
const edgeReporters = new WeakMap<Element, () => void>()

/**
 * Keep `data-scroll-edges` current through scrolling and resizing (of the
 * box, or of the content inside it: call again after replacing the content).
 */
export function watchScrollEdges(element: HTMLElement, onChange?: (edges: string) => void): void {
  const doc = element.ownerDocument
  let report = edgeReporters.get(element)
  const first = !report
  if (!report) {
    report = (): void => {
      onChange?.(updateScrollEdges(element))
    }
    edgeReporters.set(element, report)
    element.addEventListener('scroll', report, { passive: true })
  }
  report()
  adoptEditorStylesWhenConnected(element, 'mn-scroll-edges', SCROLL_EDGE_CSS)
  const Observer = doc.defaultView?.ResizeObserver
  if (!Observer) return
  let observer = edgeObservers.get(doc)
  if (!observer) {
    observer = new Observer((entries) => {
      for (const entry of entries) edgeReporters.get(entry.target)?.()
    })
    edgeObservers.set(doc, observer)
  }
  if (first) observer.observe(element)
  // The content (an SVG, a formula) can change width without the box changing.
  for (const child of Array.from(element.children)) {
    if (edgeReporters.has(child)) continue
    edgeReporters.set(child, report)
    observer.observe(child)
  }
}

/** The fade for any element carrying `data-scroll-edges`. */
export const SCROLL_EDGE_CSS = `
[data-scroll-edges] { --scroll-edge-fade: 32px; }
[data-scroll-edges='end'] {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - var(--scroll-edge-fade)), transparent);
  mask-image: linear-gradient(to right, #000 calc(100% - var(--scroll-edge-fade)), transparent);
}
[data-scroll-edges='start'] {
  -webkit-mask-image: linear-gradient(to left, #000 calc(100% - var(--scroll-edge-fade)), transparent);
  mask-image: linear-gradient(to left, #000 calc(100% - var(--scroll-edge-fade)), transparent);
}
[data-scroll-edges='start end'] {
  -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--scroll-edge-fade), #000 calc(100% - var(--scroll-edge-fade)), transparent);
  mask-image: linear-gradient(to right, transparent, #000 var(--scroll-edge-fade), #000 calc(100% - var(--scroll-edge-fade)), transparent);
}
`
