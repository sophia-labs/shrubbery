import { afterEach, describe, expect, it } from 'vitest'
import '../mn-workspace-selector.js'
import '../mn-garden-home.js'
import type { MnWorkspaceSelector, MnWorkspaceSummary } from '../mn-workspace-selector.js'
import type { MnGardenHome } from '../mn-garden-home.js'

const canonical: MnWorkspaceSummary = { graphId: 'retained', title: 'Retained work', role: 'owner', cellState: 'stopped', lastOpenedAt: Date.now() }
afterEach(() => document.body.replaceChildren())

describe.each(['pending', 'conflict'] as const)('local creation %s opening boundary', status => {
  const local: MnWorkspaceSummary = { ...canonical, localCreation: { status } }

  it('keeps selector entry labelled but prevents selection until real confirmation', async () => {
    const selector = document.createElement('mn-workspace-selector') as MnWorkspaceSelector
    selector.workspaces = [local]
    selector.status = 'ready'
    let selections = 0
    selector.addEventListener('mn-workspace-select', () => { selections += 1 })
    document.body.append(selector)
    await selector.updateComplete
    selector.shadowRoot!.querySelector<HTMLButtonElement>('.trigger')!.click()
    await selector.updateComplete
    const row = selector.shadowRoot!.querySelector('[data-graph-id="retained"]')!
    const open = row.querySelector<HTMLButtonElement>('.select')!
    expect(open.disabled).toBe(true)
    expect(row.textContent).toContain('Saved locally')
    expect(row.textContent).toContain('Retry cloud confirmation before opening')
    expect(row.querySelector('.more')).toBeNull()
    open.click()
    // Also exercise the intent guard, independently of the native disabled control.
    open.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(selections).toBe(0)

    selector.workspaces = [canonical]
    await selector.updateComplete
    const confirmed = selector.shadowRoot!.querySelector<HTMLButtonElement>('[data-graph-id="retained"] .select')!
    expect(confirmed.disabled).toBe(false)
    confirmed.click()
    expect(selections).toBe(1)
  })

  it('keeps Home entry retained but non-openable, including the recent shortcut', async () => {
    const home = document.createElement('mn-garden-home') as MnGardenHome
    home.workspaces = [local]
    home.status = 'ready'
    let opens = 0
    home.addEventListener('mn-garden-home-open-graph', () => { opens += 1 })
    document.body.append(home)
    await home.updateComplete
    const card = home.shadowRoot!.querySelector('.graph-card')!
    expect(card.querySelector<HTMLButtonElement>('.open-graph')!.disabled).toBe(true)
    expect(card.querySelector<HTMLButtonElement>('.access')!.disabled).toBe(true)
    expect(card.textContent).toContain('Retry cloud confirmation before opening')
    const buttons = home.shadowRoot!.querySelectorAll<HTMLButtonElement>('.open-graph, .recent-card')
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      expect(button.disabled).toBe(true)
      button.click()
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }
    expect(opens).toBe(0)

    home.workspaces = [canonical]
    await home.updateComplete
    const confirmed = home.shadowRoot!.querySelector<HTMLButtonElement>('.open-graph')!
    expect(confirmed.disabled).toBe(false)
    expect(home.shadowRoot!.querySelector<HTMLButtonElement>('.recent-card')!.disabled).toBe(false)
    confirmed.click()
    expect(opens).toBe(1)
  })
})
