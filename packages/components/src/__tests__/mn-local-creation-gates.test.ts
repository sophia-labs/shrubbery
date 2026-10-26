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
    // It says the work is kept, and offers Retry (and, once refused, Discard) instead of an instruction alone.
    expect(card.textContent).toContain('Local work is retained')
    expect(card.querySelector<HTMLButtonElement>('.retry-create')!.disabled).toBe(false)
    expect(Boolean(card.querySelector('.discard-create'))).toBe(status === 'conflict')
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

describe('a workspace refused at the workspace limit', () => {
  it('says so, and offers Retry and Discard for the retained work', async () => {
    const home = document.createElement('mn-garden-home') as MnGardenHome
    const refused: MnWorkspaceSummary = { ...canonical, localCreation: { status: 'conflict', reason: 'quota_exceeded', error: 'graph quota exceeded' } }
    home.workspaces = [refused]
    home.status = 'ready'
    const retried: MnWorkspaceSummary[] = []
    const discarded: MnWorkspaceSummary[] = []
    home.addEventListener('mn-garden-home-retry-create', event => retried.push((event as CustomEvent<{ workspace: MnWorkspaceSummary }>).detail.workspace))
    home.addEventListener('mn-garden-home-discard-create', event => discarded.push((event as CustomEvent<{ workspace: MnWorkspaceSummary }>).detail.workspace))
    document.body.append(home)
    await home.updateComplete
    const card = home.shadowRoot!.querySelector('.graph-card')!
    expect(card.querySelector('[role="alert"]')?.textContent).toBe('You\'ve reached your workspace limit. Delete a workspace, or ask for more.')
    expect(card.textContent).not.toContain('not yet confirmed')
    card.querySelector<HTMLButtonElement>('.retry-create')!.click()
    card.querySelector<HTMLButtonElement>('.discard-create')!.click()
    expect(retried).toEqual([refused])
    expect(discarded).toEqual([refused])
    expect(card.querySelector('.discard-create')?.getAttribute('aria-label')).toBe('Discard Retained work')

    home.busyGraphId = 'retained'
    await home.updateComplete
    expect(card.querySelector<HTMLButtonElement>('.retry-create')!.disabled).toBe(true)
  })
})
