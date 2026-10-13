/**
 * Mithras Flow in the app picker — driven through the REAL nucleus
 * interpreter (deriveAppTabs / planFor / validateConfig) and the REAL render
 * host (renderWorkspace into a happy-dom host). No mocks.
 */
import { describe, expect, it } from 'vitest'
import '@shrubbery/components'
import { deriveAppTabs, GARDEN_DEFAULT, planFor, validateConfig } from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import { GARDEN_ONLY_DEFAULT } from '../session-store.js'
import { withGrapevineWorkspace } from '../grapevine-workspace.js'
import { FLOW_APP_ID, FLOW_FRAME_TAG, FLOW_REGION_ID, flowAppEnabled, withFlowWorkspace } from '../flow-workspace.js'
import { createFlowAppFeature } from '../flow-feature.js'
import { ShFlowAppFrame } from '../flow-app-frame.js'
import type { ShellContext } from '../shell-context.js'

describe('withFlowWorkspace', () => {
  it('is off unless the build opts in, and then leaves the config untouched', () => {
    expect(flowAppEnabled({})).toBe(false)
    expect(flowAppEnabled({ VITE_SHRUBBERY_FLOW_APP: '0' })).toBe(false)
    expect(flowAppEnabled({ VITE_SHRUBBERY_FLOW_APP: '1' })).toBe(true)
    expect(withFlowWorkspace(GARDEN_ONLY_DEFAULT, false)).toBe(GARDEN_ONLY_DEFAULT)
  })

  it('gives a Garden-only config exactly two apps, Garden first, and a valid Flow spine', () => {
    expect(deriveAppTabs(GARDEN_ONLY_DEFAULT)).toEqual(['garden'])
    const view = withFlowWorkspace(GARDEN_ONLY_DEFAULT, true)
    expect(deriveAppTabs(view)).toEqual(['garden', FLOW_APP_ID])
    expect(validateConfig(view).ok).toBe(true)
    // Garden's own plan is unchanged by the composition.
    expect(planFor(view, 'garden')).toEqual(planFor(GARDEN_ONLY_DEFAULT, 'garden'))
    const flowPlan = JSON.stringify(planFor(view, FLOW_APP_ID))
    expect(flowPlan).toContain(FLOW_REGION_ID)
    expect(flowPlan).not.toContain('region-left-rail')
  })

  it('does not wake Grapevine: composed after it, Flow adds no app Grapevine can attach to', () => {
    const chained = withFlowWorkspace(withGrapevineWorkspace(GARDEN_ONLY_DEFAULT), true)
    expect(deriveAppTabs(chained)).toEqual(['garden', FLOW_APP_ID])
  })

  it('appends to an existing app dimension and is idempotent', () => {
    const view = withFlowWorkspace(GARDEN_DEFAULT, true)
    expect(deriveAppTabs(view)).toEqual([...deriveAppTabs(GARDEN_DEFAULT), FLOW_APP_ID])
    expect(withFlowWorkspace(view, true)).toBe(view)
    expect(withFlowWorkspace(GARDEN_DEFAULT, true)).toBe(view)
  })

  it('renders the Flow region as the frame when the Flow app is active', async () => {
    const view = withFlowWorkspace(GARDEN_ONLY_DEFAULT, true)
    const flowHost = renderWorkspace(view, { app: FLOW_APP_ID })
    expect(flowHost.querySelector(FLOW_FRAME_TAG)).not.toBeNull()
    // Garden, on the same composed config, has no Flow frame.
    const gardenHost = renderWorkspace(view, { app: 'garden' })
    expect(gardenHost.querySelector(FLOW_FRAME_TAG)).toBeNull()
  })
})

describe('sh-flow-app-frame', () => {
  it('frames /flow/ on the active graph and never guesses a graph', async () => {
    const frame = new ShFlowAppFrame()
    document.body.append(frame)
    await frame.updateComplete
    expect(frame.frameSrc).toBe('')
    expect(frame.shadowRoot?.querySelector('iframe')).toBeNull()
    frame.graphId = 'mithras flow'
    await frame.updateComplete
    expect(frame.frameSrc).toBe('/flow/?graph=mithras%20flow')
    expect(frame.shadowRoot?.querySelector('iframe')?.getAttribute('src')).toBe('/flow/?graph=mithras%20flow')
    frame.remove()
  })
})

describe('createFlowAppFeature', () => {
  const ctx = (host: HTMLElement, app: string, graphId: string) =>
    ({ host, app, graphId }) as unknown as ShellContext<unknown>

  it('retains one frame per graph across re-renders and drops it on a graph switch', () => {
    const feature = createFlowAppFeature({ enabled: true })
    const host = document.createElement('div')
    const first = document.createElement(FLOW_FRAME_TAG)
    host.append(first)
    feature.afterWorkspaceRender?.(ctx(host, FLOW_APP_ID, 'g1'), {})
    expect(first.graphId).toBe('g1')

    // A re-render stamps a fresh placeholder; the retained frame goes back in.
    const second = document.createElement(FLOW_FRAME_TAG)
    host.replaceChildren(second)
    feature.afterWorkspaceRender?.(ctx(host, FLOW_APP_ID, 'g1'), {})
    expect(host.querySelector(FLOW_FRAME_TAG)).toBe(first)

    // Leaving Flow keeps it; a different graph drops it.
    feature.afterWorkspaceRender?.(ctx(host, 'garden', 'g1'), {})
    const third = document.createElement(FLOW_FRAME_TAG)
    host.replaceChildren(third)
    feature.afterWorkspaceRender?.(ctx(host, FLOW_APP_ID, 'g2'), {})
    expect(host.querySelector(FLOW_FRAME_TAG)).toBe(third)
    expect(third.graphId).toBe('g2')
  })

  it('does nothing when disabled', () => {
    const feature = createFlowAppFeature({ enabled: false })
    const host = document.createElement('div')
    const placeholder = document.createElement(FLOW_FRAME_TAG)
    host.append(placeholder)
    feature.afterWorkspaceRender?.(ctx(host, FLOW_APP_ID, 'g1'), {})
    expect(placeholder.graphId).toBe('')
  })
})
