/**
 * default-workspace-ui.test.ts — the fallback's honest chrome, driven through
 * the REAL read/render machinery (no mocks; closure-seam contracts only):
 *
 *   - a graph with an EMPTY :ux:config (no sux:Workspace node) reaches 'ready'
 *     with the in-memory GARDEN_DEFAULT, renders a real workspace DOM, and the
 *     once-per-graph "default workspace" notice appears;
 *   - the dashboard-marker walk over the fallback is byte-identical to a seeded
 *     GardenDefault (it is the SAME config object);
 *   - the notice never re-spawns on poll re-syncs and is dropped the moment a
 *     real config wins;
 *   - the TRUE-error panel paints an honest, verbatim error into the render
 *     host (the second bug: outside ?debug=1 the status strip is hidden, so a
 *     failed first load used to leave a blank page).
 */
import { describe, expect, it } from 'vitest'
import '@shrubbery/components'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import { GARDEN_ONLY_DEFAULT, createSessionStore, type CellContract } from '../session-store.js'
import { configDeclaresDashboardCenter, fragmentRegionsOf } from '../workspace-fragments.js'
import {
  CELL_ERROR_PANEL_CLASS,
  clearCellErrorPanel,
  renderCellErrorPanel,
} from '../default-workspace-ui.js'
import { withGrapevineWorkspace } from '../grapevine-workspace.js'

/** Closure-seam cell contract: the real read path over a canned :ux:config body. */
function contractFor(nt: string): CellContract {
  return {
    restConcrete: {
      dumpUxConfig: async () => ({ data: nt }),
    },
  } as unknown as CellContract
}


describe('no-workspace fallback — Garden only', () => {
  it('an empty triple set reaches ready and renders the Garden-only default', async () => {
    // REAL parse path over the empty :ux:config a fresh graph presents.
    const store = createSessionStore({ contract: contractFor(''), graphId: 'fresh-graph' })
    await store.refresh()
    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.read?.defaulted).toBe(true)

    // The fallback RENDERS — the same render path the shell drives.
    const config = state.read!.config
    expect(config).toBe(GARDEN_ONLY_DEFAULT)
    const container = renderWorkspace(config)
    expect(container.querySelector('.app-container')).not.toBeNull()
    expect(container.querySelector('.app-container .main')).not.toBeNull()

    // Garden alone: no Choreograph region-set, no app dimension, and the
    // host-only Grapevine views decline to attach.
    expect(config.appRootRegions).toBeUndefined()
    expect(config.dimensions['dim-app']).toBeUndefined()
    expect(config.regions['region-choreo-center']).toBeUndefined()
    expect(withGrapevineWorkspace(config)).toBe(config)

    // Same Garden chrome and fragments as the seeded GardenDefault.
    expect(config.rootRegions).toEqual(GARDEN_DEFAULT.rootRegions)
    expect(configDeclaresDashboardCenter(config)).toBe(configDeclaresDashboardCenter(GARDEN_DEFAULT))
    expect(fragmentRegionsOf(config)).toEqual(fragmentRegionsOf(GARDEN_DEFAULT))

    // No "default workspace" toast any more.
    expect(document.querySelector('mn-toast')).toBeNull()
  })
})

describe('true-error panel — the honest non-blank failure surface', () => {
  it('offers the hosted escape route without retrying or fabricating a workspace', () => {
    const host = document.createElement('div')
    let returns = 0
    const panel = renderCellErrorPanel(host, 'HTTP 403', { onBack: () => { returns++ } })
    const button = panel.querySelector(`.${CELL_ERROR_PANEL_CLASS}__back`) as HTMLButtonElement
    expect(button.textContent).toBe('Back to workspaces')
    expect(panel.querySelector(`.${CELL_ERROR_PANEL_CLASS}__retry`)).toBeNull()
    button.click()
    expect(returns).toBe(1)
    expect(host.querySelector('.app-container')).toBeNull()
  })
  it('paints the verbatim error into the host, replaces (never stacks), and wires retry', () => {
    const host = document.createElement('div')
    // The static pre-module boot shell the panel must retire.
    const placeholder = document.createElement('div')
    placeholder.className = 'boot-placeholder'
    host.appendChild(placeholder)
    document.body.appendChild(host)

    let retried = 0
    renderCellErrorPanel(host, 'config rejected: I2 cyclic childRegion spine', {
      onRetry: () => {
        retried += 1
      },
    })
    expect(host.querySelector('.boot-placeholder')).toBeNull()
    const panel = host.querySelector(`.${CELL_ERROR_PANEL_CLASS}`)
    expect(panel).not.toBeNull()
    expect(panel!.getAttribute('role')).toBe('alert')
    // VERBATIM message — no softening.
    expect(panel!.querySelector(`.${CELL_ERROR_PANEL_CLASS}__message`)!.textContent).toBe(
      'config rejected: I2 cyclic childRegion spine',
    )
    ;(panel!.querySelector(`.${CELL_ERROR_PANEL_CLASS}__retry`) as HTMLButtonElement).click()
    expect(retried).toBe(1)

    // A second failure REPLACES the panel (no stacking) …
    renderCellErrorPanel(host, 'second failure')
    const panels = host.querySelectorAll(`.${CELL_ERROR_PANEL_CLASS}`)
    expect(panels.length).toBe(1)
    expect(panels[0].querySelector(`.${CELL_ERROR_PANEL_CLASS}__message`)!.textContent).toBe('second failure')
    // … and no retry button when no handler is wired.
    expect(panels[0].querySelector(`.${CELL_ERROR_PANEL_CLASS}__retry`)).toBeNull()

    // The successful-render seam clears it.
    clearCellErrorPanel(host)
    expect(host.querySelector(`.${CELL_ERROR_PANEL_CLASS}`)).toBeNull()
    host.remove()
  })
})
