/** Vertical spans (in mount coordinates) where the guide must not run. */
export interface GutterGap { readonly top: number; readonly bottom: number }

/**
 * The trunk from `start` to `end` minus the gaps: embeds (query blocks,
 * figures, kept-as-stored placeholders — anything marked `data-block-embed`)
 * are objects set into the outline, not items of it, so the guide stops above
 * them and resumes below. Pure, for tests.
 */
export function trunkSegments(start: number, end: number, gaps: readonly GutterGap[]): Array<[number, number]> {
  const segments: Array<[number, number]> = []
  let cursor = start
  for (const gap of [...gaps].sort((a, b) => a.top - b.top)) {
    if (gap.bottom <= cursor || gap.top >= end) continue
    if (gap.top > cursor) segments.push([cursor, gap.top])
    cursor = Math.max(cursor, gap.bottom)
  }
  if (cursor < end) segments.push([cursor, end])
  return segments
}

/** Gap padding around an embed, so the line ends clear of its edge. */
const EMBED_GAP_PAD = 6

/** Passive linework for the live outliner. Kept outside ProseMirror so layout
 * measurement never becomes an editor transaction or a collaborative edit. */
export function installOutlinerGutter(mount: HTMLElement, editor: HTMLElement): () => void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  svg.classList.add('outliner-gutter')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.append(path)
  mount.append(svg)
  let frame = 0
  let disposed = false
  const observed = new Set<Element>()

  const paint = (): void => {
    frame = 0
    if (disposed) return
    // The editor is a flat, non-virtualized block list. Measure rendered controls
    // rather than document offsets: folded/zoomed blocks have no client rects,
    // and wrapped text, tables, images and indentation supply their real sizes.
    const origin = mount.getBoundingClientRect()
    const points = Array.from(editor.querySelectorAll<HTMLElement>('.outliner-node-button'))
      .filter(button => button.getClientRects().length > 0)
      .map(button => {
        const rect = button.getBoundingClientRect()
        return {
          x: rect.left + rect.width / 2 - origin.left + mount.scrollLeft - mount.clientLeft,
          y: rect.top + rect.height / 2 - origin.top + mount.scrollTop - mount.clientTop,
        }
      })
    // One uninterrupted trunk; short level branches end at nested stations.
    // No dangling extension above the first or below the last visible node.
    const x = Math.min(...points.map(point => point.x))
    const gaps = Array.from(editor.querySelectorAll<HTMLElement>('[data-block-embed]'))
      .filter(embed => embed.getClientRects().length > 0)
      .map(embed => {
        const rect = embed.getBoundingClientRect()
        const top = rect.top - origin.top + mount.scrollTop - mount.clientTop
        return { top: top - EMBED_GAP_PAD, bottom: top + rect.height + EMBED_GAP_PAD }
      })
    const line = points.length < 2 ? '' : [
      ...trunkSegments(points[0].y, points[points.length - 1].y, gaps).map(([from, to]) => `M ${x} ${from} V ${to}`),
      ...points.filter(point => point.x > x).map(point => `M ${x} ${point.y} H ${point.x}`),
    ].join(' ')
    path.setAttribute('d', line)
    // Paper material can override a dark shell's tokens inside ProseMirror.
    svg.style.color = getComputedStyle(editor).getPropertyValue('--mn-color-text-tertiary').trim() || '#697386'

    const blocks = new Set(Array.from(editor.children))
    for (const block of observed) {
      if (!blocks.has(block)) { resize?.unobserve(block); observed.delete(block) }
    }
    for (const block of blocks) {
      if (!observed.has(block)) { resize?.observe(block); observed.add(block) }
    }
  }
  const schedule = (): void => {
    if (!disposed && !frame) frame = requestAnimationFrame(paint)
  }
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  resize?.observe(editor)
  resize?.observe(mount)
  const changes = new MutationObserver(schedule)
  changes.observe(editor, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'data-indent'],
  })
  const theme = new MutationObserver(schedule)
  theme.observe(document.documentElement, { attributes: true })
  const host = mount.getRootNode() instanceof ShadowRoot ? (mount.getRootNode() as ShadowRoot).host : null
  if (host) theme.observe(host, { attributes: true, attributeFilter: ['editor-material'] })
  schedule()
  return () => {
    disposed = true
    cancelAnimationFrame(frame)
    resize?.disconnect()
    changes.disconnect()
    theme.disconnect()
    svg.remove()
  }
}
