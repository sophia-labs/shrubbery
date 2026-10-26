import type { EditorStructureChangeDetail } from './editor-host.js'

/**
 * Decides, for each `mn-editor-structure-change` event, whether the heading
 * list of the editor that sent it changed since the last event the gate saw
 * from that same editor. Consumers that only draw headings (the pane-header TOC
 * trigger and dropdown, the outline panel) ask this instead of re-rendering on
 * every keystroke.
 *
 * - `selection` events never change headings: false.
 * - `mounted` events always report true (a fresh editor, nothing to compare).
 * - An event without a signature (an older editor build) is treated as changed.
 */
export function createHeadingsChangeGate(): (event: Event) => boolean {
  const seen = new WeakMap<object, string>()
  return (event: Event): boolean => {
    const detail = (event as CustomEvent<EditorStructureChangeDetail | undefined>).detail
    if (detail?.reason === 'selection') return false
    const signature = detail?.headingsSignature
    const origin = event.composedPath()[0] ?? event.target
    if (signature === undefined || !origin || typeof origin !== 'object') return true
    const previous = seen.get(origin)
    seen.set(origin, signature)
    if (detail?.reason === 'mounted') return true
    return previous !== signature
  }
}
