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
import { createSessionStore, type CellContract } from '../session-store.js'
import { configDeclaresDashboardCenter, fragmentRegionsOf } from '../workspace-fragments.js'
import {
  CELL_ERROR_PANEL_CLASS,
  DEFAULT_WORKSPACE_NOTICE_ATTR,
  DEFAULT_WORKSPACE_NOTICE_MESSAGE,
  clearCellErrorPanel,
  makeDefaultWorkspaceNotice,
  renderCellErrorPanel,
} from '../default-workspace-ui.js'

/** Closure-seam cell contract: the real read path over a canned :ux:config body. */
function contractFor(nt: string): CellContract {
  return {
    restConcrete: {
      dumpUxConfig: async () => ({ data: nt }),
    },
  } as unknown as CellContract
}

const flushTimers = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('no-workspace fallback — renders + notice present', () => {
  it('an empty triple set reaches ready, renders a real workspace, and shows the notice once', async () => {
    // REAL parse path over the empty :ux:config a fresh graph presents.
    const store = createSessionStore({ contract: contractFor(''), graphId: 'fresh-graph' })
    await store.refresh()
    const state = store.getState()
    expect(state.status).toBe('ready')
    expect(state.read?.defaulted).toBe(true)

    // The fallback RENDERS — the same render path the shell drives.
    const container = renderWorkspace(state.read!.config)
    expect(container.querySelector('.app-container')).not.toBeNull()
    expect(container.querySelector('.app-container .main')).not.toBeNull()

    // Dashboard-marker / fragment machinery parity with a seeded GardenDefault:
    // it IS the same config object, so the walks agree exactly.
    expect(state.read!.config).toBe(GARDEN_DEFAULT)
    expect(configDeclaresDashboardCenter(state.read!.config)).toBe(
      configDeclaresDashboardCenter(GARDEN_DEFAULT),
    )
    expect(fragmentRegionsOf(state.read!.config)).toEqual(fragmentRegionsOf(GARDEN_DEFAULT))

    // The notice appears in the chrome, honest and small.
    const notice = makeDefaultWorkspaceNotice(document)
    notice.sync(state.read!.defaulted, 'fresh-graph')
    const toast = document.querySelector(`mn-toast[${DEFAULT_WORKSPACE_NOTICE_ATTR}="fresh-graph"]`)
    expect(toast).not.toBeNull()
    expect((toast as { message?: string }).message).toBe(DEFAULT_WORKSPACE_NOTICE_MESSAGE)
    expect((toast as { closable?: boolean }).closable).toBe(true)

    // Idempotent under the poll loop: re-syncing the same graph re-uses the
    // one toast (no stacking, no re-spawn after dismissal/auto-quiet).
    notice.sync(true, 'fresh-graph')
    notice.sync(true, 'fresh-graph')
    expect(document.querySelectorAll(`mn-toast[${DEFAULT_WORKSPACE_NOTICE_ATTR}]`).length).toBe(1)

    // The moment a real config wins (defaulted=false), the notice is dropped.
    notice.element()!.animationMs = 0
    notice.sync(false, 'fresh-graph')
    await flushTimers()
    expect(document.querySelector(`mn-toast[${DEFAULT_WORKSPACE_NOTICE_ATTR}]`)).toBeNull()
    expect(notice.element()).toBeNull()
  })
})

describe('true-error panel — the honest non-blank failure surface', () => {
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
