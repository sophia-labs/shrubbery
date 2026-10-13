/** Real Surface composition + production shell cascade; no layout-engine claim. */
import { describe, expect, it } from 'vitest'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace, workspaceSurfaceReady } from '@shrubbery/runtime'
import { MnSidebarPanel } from '../../../../../packages/components/src/mn-sidebar-panel.js'
import shellHtml from '../../../index.html?raw'

describe('Garden sidebar scrolling: production shell composition', () => {
  it.each(['tree', 'columns', 'search-results'] as const)('retains the sidebar flex owner for %s with an overflowing-sized collection', async (presentation) => {
    // Extract styles without parsing executable script tags into happy-dom.
    for (const match of shellHtml.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
      const style = document.createElement('style')
      style.textContent = match[1]
      document.head.append(style)
    }
    const host = document.createElement('div')
    host.id = 'host'
    document.body.append(host)
    renderWorkspace(GARDEN_DEFAULT, {
      container: host,
      surface: true,
      rightCollapsed: true,
      sidebar: {
        presentation: presentation === 'search-results' ? 'tree' : presentation,
        searchQuery: presentation === 'search-results' ? 'Scroll row' : '',
        sections: [{ id: 'documents', label: 'Documents', nodes: Array.from({ length: 100 }, (_, i) => ({ id: `scroll-${i}`, label: `Scroll row ${String(i).padStart(3, '0')}`, kind: 'document' as const })) }],
      },
    })
    await workspaceSurfaceReady(host)
    const sidebar = host.querySelector('[data-surface-part="sidebar"] > mn-sidebar-panel') as MnSidebarPanel
    expect(sidebar).toBeInstanceOf(MnSidebarPanel)
    await sidebar.updateComplete
    expect(sidebar.shadowRoot!.querySelectorAll('[data-node-id]')).toHaveLength(100)
    expect(sidebar.shadowRoot!.querySelector('[data-node-id="scroll-99"]')).not.toBeNull()
    expect(sidebar.closest('sh-workspace-surface')).not.toBeNull()
    expect(sidebar.parentElement!.classList.contains('surface-leaf')).toBe(true)
    // happy-dom incorrectly lets shadow :host win over outer styles here.
    // Examine actual CSSOM rules against the actual Surface-mounted element;
    // real Chromium, separately, is the oracle for cascade/geometry/input.
    const externalDisplays = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
      .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && sidebar.matches(rule.selectorText)
        // happy-dom also matches :not(:defined) for registered elements. The
        // inert-placeholder fallback cannot apply to this upgraded sidebar.
        && !(rule.selectorText.includes(':not(:defined)') && customElements.get(sidebar.localName)))
      .map(rule => rule.style.display).filter(Boolean)
    host.remove()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(externalDisplays.at(-1)).toBe('flex')
  })
})
