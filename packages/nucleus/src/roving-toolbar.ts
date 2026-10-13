/**
 * A toolbar that is one Tab stop: exactly one item has tabindex 0, the arrows (and Home/End) move between items, Tab
 * leaves. Idempotent and render-safe: call it after every render (and it follows later changes by itself). Works in a
 * shadow root or in light DOM. Several roots may form one toolbar. Left/Right belong to the toolbar even on a <select>
 * (Up/Down change its value); a text field keeps its caret keys.
 */
const ITEMS = 'button, select, input:not([type="hidden"]):not([type="file"]), [role="radio"]'
const GROUP = Symbol.for('shrubbery.rovingToolbar')
type Rooted = Element & { [GROUP]?: Element[] }

function itemsOf(roots: readonly Element[]): HTMLElement[] {
  return roots.flatMap(root => [...root.querySelectorAll<HTMLElement>(ITEMS)])
    .filter(el => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-hidden') !== 'true')
}

function settle(roots: readonly Element[], chosen?: HTMLElement): void {
  const all = itemsOf(roots)
  const current = chosen ?? all.find(el => el.dataset.rovingCurrent === '1') ?? all[0]
  for (const el of all) {
    el.tabIndex = el === current ? 0 : -1
    if (el === current) el.dataset.rovingCurrent = '1'; else delete el.dataset.rovingCurrent
  }
}

export function rovingToolbar(first: Element | null | undefined, ...more: (Element | null | undefined)[]): void {
  const roots = [first, ...more].filter((el): el is Element => !!el)
  if (!roots.length) return
  settle(roots)
  for (const root of roots) {
    const holder = root as Rooted
    if (holder[GROUP]) { holder[GROUP] = roots; continue }
    holder[GROUP] = roots
    const group = () => holder[GROUP] ?? roots
    // Items that come and go with a render join the one stop, not a new one.
    if (typeof MutationObserver !== 'undefined') {
      let queued = false
      new MutationObserver(() => {
        if (queued) return
        queued = true
        queueMicrotask(() => { queued = false; settle(group()) })
      }).observe(root, { childList: true, subtree: true })
    }
    root.addEventListener('focusin', event => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(ITEMS)
      if (target && itemsOf(group()).includes(target)) settle(group(), target)
    })
    root.addEventListener('keydown', event => {
      const key = (event as KeyboardEvent).key
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox') return
      const list = itemsOf(group())
      const at = list.indexOf(target.closest<HTMLElement>(ITEMS) ?? target)
      if (at < 0) return
      const next = key === 'Home' ? 0 : key === 'End' ? list.length - 1 : (at + (key === 'ArrowRight' ? 1 : -1) + list.length) % list.length
      event.preventDefault()
      list[next]?.focus()
    })
  }
}
