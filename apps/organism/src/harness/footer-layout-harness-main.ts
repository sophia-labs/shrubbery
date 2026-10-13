/** Real component/token rendering, synthetic props; no cell, auth or app boot. */
import '@shrubbery/tokens/tokens.css'
import { applySkinTheme, type Skin } from '@shrubbery/tokens'
import '../../../../packages/components/src/mn-bottom-bar.js'
import type { MnBottomBar, ChromeSourceStatus } from '../../../../packages/components/src/mn-bottom-bar.js'

const query = new URLSearchParams(location.search)
const skin = (query.get('skin') ?? 'garden') as Skin
applySkinTheme({ skin, theme: query.get('theme') === 'dark' ? 'dark' : 'light' })
document.documentElement.style.setProperty('--mn-left-panel-width', '280px')
document.documentElement.style.setProperty('--mn-right-panel-width', query.get('rightWidth') ?? '420px')
const bar = document.querySelector('mn-bottom-bar') as MnBottomBar
bar.itemCount = 128
bar.syncState = 'synced'
bar.runtimeMode = 'hosted'
bar.leftCollapsed = query.get('leftCollapsed') === '1'
bar.rightCollapsed = query.get('rightCollapsed') === '1'
const badges: ChromeSourceStatus['badges'] = query.get('labels') === 'long' ? [
  { kind: 'contested', glyph: '◆', label: '130 contested objects awaiting a choice', accessibleName: '130 contested objects awaiting a choice. Open contested work.', hint: 'Synthetic long-label layout fixture.' },
  { kind: 'pending', glyph: '↑', label: '2 pending changes saved only on this device', accessibleName: '2 pending changes saved only on this device.', hint: 'Synthetic long-label layout fixture.' },
  { kind: 'parked', glyph: '⏸', label: '17 parked items from an earlier graph', accessibleName: '17 parked items from an earlier graph. Open parked work.', hint: 'Synthetic long-label layout fixture.' },
] : [
  { kind: 'unknown', glyph: '—', label: 'local copy unknown', accessibleName: 'Local copy unknown.', hint: 'Synthetic version of the resident footer label.' },
]
bar.sourceStatus = { badges }
if (query.get('stats') === '1') {
  bar.documentStats = { words: 12483, characters: 80312, selectedCharacters: 1024, readingTimeMinutes: 62, blockType: 'Block quotation' }
  bar.documentExportAvailable = true
}
const events: Array<{ name: string; detail: unknown }> = []
for (const name of ['mn-panel-toggle', 'mn-left-mode-change', 'mn-source-badge-activate', 'mn-document-export']) {
  bar.addEventListener(name, event => events.push({ name, detail: (event as CustomEvent).detail ?? null }))
}
Object.assign(window, { __footerLayoutEvents: events })
Object.assign(window, { __footerLayout: {
  async contestedWidth(count: number) {
    bar.sourceStatus = { badges: bar.sourceStatus!.badges.map(badge => badge.kind === 'contested' ? { ...badge, label: `${count} contested objects awaiting a choice` } : badge) }
    await bar.updateComplete
    const badge = bar.shadowRoot!.querySelector('mn-badge[data-source-badge="contested"]') as HTMLElement & { updateComplete: Promise<boolean> }
    await badge.updateComplete
    return badge.getBoundingClientRect().width
  },
  measure() {
    const sr = bar.shadowRoot!
    const rectangle = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } }
    const items = [...sr.querySelectorAll('.toggle-btn, [data-item-count], [data-document-stats] > .status-value, .export-btn, .sync-state, .runtime-pill')]
      .filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
      .map(el => ({ name: el.getAttribute('aria-label') ?? el.textContent!.trim(), ...rectangle(el) }))
    for (const badge of sr.querySelectorAll('mn-badge')) {
      const body = badge.shadowRoot!.querySelector('[part="badge"]')!
      items.push({ name: badge.getAttribute('aria-label')!, ...rectangle(body) })
    }
    const bounds = rectangle(bar), overlap: string[] = [], outside: string[] = []
    for (let i = 0; i < items.length; i++) {
      const a = items[i]
      if (a.x < bounds.x - 0.75 || a.right > bounds.right + 0.75 || a.y < bounds.y - 0.75 || a.bottom > bounds.bottom + 0.75) outside.push(a.name)
      for (const b of items.slice(i + 1)) if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.75 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.75) overlap.push(`${a.name} / ${b.name}`)
    }
    return { bounds, items, overlap, outside, viewportOverflow: document.documentElement.scrollWidth > innerWidth + 1 || bounds.bottom > innerHeight + 1, mainHeight: document.querySelector('.main')!.getBoundingClientRect().height, syncText: sr.querySelector('.sync-state')!.textContent!.trim(), rightControlCount: sr.querySelectorAll('.right-section .toggle-btn').length, leftControlCount: items.filter(item => ['Files', 'Graph', 'Outline'].includes(item.name)).length, mirrorAnnouncement: sr.querySelector('[data-mirror-status]')?.getAttribute('aria-live'), liveAnnouncement: sr.querySelector('[data-live-status]')?.getAttribute('aria-live') }
  },
} })
await bar.updateComplete
await Promise.all([...bar.shadowRoot!.querySelectorAll('mn-badge')].map(badge => (badge as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete))
await document.fonts.ready
document.body.dataset.footerLayoutReady = 'true'
