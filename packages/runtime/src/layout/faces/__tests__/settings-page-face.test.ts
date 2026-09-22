/**
 * settings-page-face.test.ts — the FAST, network-free proof: a real
 * `FaceRegistry`/`LayoutResourceBroker`/`LayoutInterpreter` and a real
 * in-memory `SettingsPageService` implementation (no network, no
 * `vi.mock`). `<mn-settings-page>` is not registered in this package
 * (`@shrubbery/runtime` cannot depend on `@shrubbery/components` —
 * `settings-page-face.ts`'s own header) so these tests drive the mounted
 * element's REAL property/event contract directly via `dispatchEvent` with
 * the SAME event names/detail shapes the real component fires — proving the
 * FACE's controller wiring, resource sharing, and the section/params
 * contract. The real component's own rendering is proven by the Chromium
 * browser script (mirrors doc-history-face.test.ts's own established
 * boundary).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deepFreeze, type LayoutDocument } from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import {
  createSettingsPageFace,
  createSettingsPageResourceAdapter,
  SETTINGS_PAGE_FACE_ID,
  SETTINGS_PAGE_IRI,
  type SettingsPageActionDetail,
  type SettingsPageJobActionDetail,
  type SettingsPageSecretActionDetail,
  type SettingsPageSection,
  type SettingsPageSelectChangeDetail,
  type SettingsPageService,
  type SettingsPageSnapshot,
  type SettingsPageToggleChangeDetail,
} from '../settings-page-face.js'

/** A REAL, working, in-memory `SettingsPageService` — not a mock of the interface, a genuine implementation of it. */
function inMemorySettingsService(): SettingsPageService & {
  readonly calls: string[]
  section(id: string): SettingsPageSection
} {
  const calls: string[] = []
  let toggled = false
  const listeners = new Set<() => void>()
  const sections: SettingsPageSection[] = [
    { id: 'account', title: 'Account', toggles: [{ id: 'notify', label: 'Notify', checked: toggled }] },
    {
      id: 'appearance',
      title: 'Appearance',
      selects: [{ id: 'theme', label: 'Theme', value: 'system', options: [{ value: 'system', label: 'System' }] }],
    },
    { id: 'api-keys', title: 'AI Provider Keys', secrets: [{ id: 'anthropic', label: 'Anthropic', configured: false }] },
    { id: 'graph-ops', title: 'Graph Ops', actions: [{ id: 'export-graph', label: 'Export graph' }] },
    { id: 'imports', title: 'Imports', jobs: [{ id: 'import-1', label: 'Import', status: 'idle' }] },
  ]
  return {
    calls,
    section(id) {
      return sections.find((section) => section.id === id)!
    },
    async load(): Promise<SettingsPageSnapshot> {
      calls.push('load')
      return { userName: 'Vera', userEmail: 'vera@example.com', sections }
    },
    async toggle(detail: SettingsPageToggleChangeDetail) {
      calls.push(`toggle:${detail.settingId}:${detail.checked}`)
      toggled = detail.checked
      sections[0] = { ...sections[0]!, toggles: [{ id: 'notify', label: 'Notify', checked: toggled }] }
    },
    async select(detail: SettingsPageSelectChangeDetail) {
      calls.push(`select:${detail.settingId}:${detail.value}`)
    },
    async secret(detail: SettingsPageSecretActionDetail) {
      calls.push(`secret:${detail.secretId}:${detail.action}`)
    },
    async action(detail: SettingsPageActionDetail) {
      calls.push(`action:${detail.actionId}`)
    },
    async job(detail: SettingsPageJobActionDetail) {
      calls.push(`job:${detail.jobId}`)
    },
    subscribe(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
  }
}

function settingsLeaf(id: string, section?: string): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'settings-solo',
    scope: 'session',
    graphId: null,
    rootNodeId: id,
    nodes: {
      [id]: {
        kind: 'leaf' as const,
        id,
        descriptor: {
          schemaVersion: 1 as const,
          faceId: SETTINGS_PAGE_FACE_ID,
          resource: { kind: 'iri' as const, iri: SETTINGS_PAGE_IRI },
          ...(section ? { params: { section } } : {}),
        },
        descriptorRevision: 0,
      },
    },
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  })
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

describe('settings.page — resource adapter', () => {
  it('accepts only the well-known settings iri; resourceKey is stable', () => {
    const service = inMemorySettingsService()
    const adapter = createSettingsPageResourceAdapter(service)
    expect(adapter.shape).toBe('durable')
    expect(adapter.accepts({ kind: 'iri', iri: SETTINGS_PAGE_IRI })).toBe(true)
    expect(adapter.accepts({ kind: 'iri', iri: 'urn:sophia:home' })).toBe(false)
    expect(adapter.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
    expect(adapter.resourceKey({ kind: 'iri', iri: SETTINGS_PAGE_IRI })).toBe(
      adapter.resourceKey({ kind: 'iri', iri: SETTINGS_PAGE_IRI }),
    )
  })

  it('load() returns the injected service instance verbatim (the durable resource IS the service)', async () => {
    const service = inMemorySettingsService()
    const adapter = createSettingsPageResourceAdapter(service)
    const loaded = await adapter.load({ kind: 'iri', iri: SETTINGS_PAGE_IRI })
    expect(loaded).toBe(service)
  })
})

describe('settings.page — mounted against a real registry/broker/interpreter', () => {
  function buildVehicle(service: SettingsPageService) {
    const registry = new FaceRegistry()
    registry.register(createSettingsPageFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createSettingsPageResourceAdapter(service))
    return new LayoutInterpreter(root, { registry, broker })
  }

  it('mounts the real element by tag, loads the real snapshot, and defaults to the account section', async () => {
    const service = inMemorySettingsService()
    const interpreter = buildVehicle(service)
    const result = await interpreter.reconcile(settingsLeaf('S1'), { width: 900, height: 600 })
    expect(result.ok).toBe(true)

    const wrapper = interpreter.leafWrapperElement('S1')!
    const page = wrapper.querySelector('mn-settings-page') as HTMLElement & {
      status: string
      activeSection: string
      userName: string
      sections: readonly SettingsPageSection[]
      showClose: boolean
    }
    expect(page).not.toBeNull()
    expect(page.activeSection).toBe('account')
    expect(service.calls).toContain('load')
    expect(page.status).toBe('ready')
    expect(page.userName).toBe('Vera')
    expect(page.sections.map((section) => section.id)).toEqual(['account', 'appearance', 'api-keys', 'graph-ops', 'imports'])
    // wave1 review r1 WRONG fix: the leaf mount hides BOTH real close
    // controls (`mn-settings-page.ts`'s own new `showClose`) rather than
    // rendering one that silently ignores clicks.
    expect(page.showClose).toBe(false)

    await interpreter.dispose()
  })

  it('honors a params.section override as the initial active section', async () => {
    const service = inMemorySettingsService()
    const interpreter = buildVehicle(service)
    await interpreter.reconcile(settingsLeaf('S1', 'appearance'), { width: 900, height: 600 })
    const page = interpreter.leafWrapperElement('S1')!.querySelector('mn-settings-page') as HTMLElement & { activeSection: string }
    expect(page.activeSection).toBe('appearance')
    await interpreter.dispose()
  })

  it('toggle/select/secret/action/job events round-trip through the real service, then reload', async () => {
    const service = inMemorySettingsService()
    const interpreter = buildVehicle(service)
    await interpreter.reconcile(settingsLeaf('S1'), { width: 900, height: 600 })
    const page = interpreter.leafWrapperElement('S1')!.querySelector('mn-settings-page') as HTMLElement & {
      sections: readonly SettingsPageSection[]
    }

    page.dispatchEvent(new CustomEvent('mn-settings-toggle-change', {
      bubbles: true,
      detail: { sectionId: 'account', settingId: 'notify', checked: true } satisfies SettingsPageToggleChangeDetail,
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(service.calls).toContain('toggle:notify:true')
    expect(page.sections[0]!.toggles?.[0]?.checked).toBe(true)

    page.dispatchEvent(new CustomEvent('mn-settings-select-change', {
      bubbles: true,
      detail: { sectionId: 'appearance', settingId: 'theme', value: 'dark' } satisfies SettingsPageSelectChangeDetail,
    }))
    page.dispatchEvent(new CustomEvent('mn-settings-secret-action', {
      bubbles: true,
      detail: { sectionId: 'api-keys', secretId: 'anthropic', action: 'configure' } satisfies SettingsPageSecretActionDetail,
    }))
    page.dispatchEvent(new CustomEvent('mn-settings-action', {
      bubbles: true,
      detail: { sectionId: 'graph-ops', actionId: 'export-graph' } satisfies SettingsPageActionDetail,
    }))
    page.dispatchEvent(new CustomEvent('mn-settings-job-action', {
      bubbles: true,
      detail: { sectionId: 'imports', jobId: 'import-1' } satisfies SettingsPageJobActionDetail,
    }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(service.calls).toContain('select:theme:dark')
    expect(service.calls).toContain('secret:anthropic:configure')
    expect(service.calls).toContain('action:export-graph')
    expect(service.calls).toContain('job:import-1')

    await interpreter.dispose()
  })

  it('mn-settings-close is a defensive no-op (unreachable now that showClose=false hides both real controls); the leaf stays mounted', async () => {
    const service = inMemorySettingsService()
    const interpreter = buildVehicle(service)
    await interpreter.reconcile(settingsLeaf('S1'), { width: 900, height: 600 })
    const page = interpreter.leafWrapperElement('S1')!.querySelector('mn-settings-page')!
    page.dispatchEvent(new CustomEvent('mn-settings-close', { bubbles: true }))
    expect(interpreter.leafWrapperElement('S1')!.querySelector('mn-settings-page')).not.toBeNull()
    await interpreter.dispose()
  })

  it('two settings.page leaves share the SAME injected service instance (one durable resource)', async () => {
    const service = inMemorySettingsService()
    const registry = new FaceRegistry()
    registry.register(createSettingsPageFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createSettingsPageResourceAdapter(service))
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    const doc: LayoutDocument = deepFreeze({
      schemaVersion: 1,
      layoutId: 'two-settings',
      scope: 'session',
      graphId: null,
      rootNodeId: 'split',
      nodes: {
        split: { kind: 'split', id: 'split', axis: 'horizontal', startNodeId: 'S1', endNodeId: 'S2', startBasisPoints: 5000 },
        S1: settingsLeaf('S1').nodes.S1!,
        S2: settingsLeaf('S2', 'billing').nodes.S2!,
      },
      createdAt: '2026-07-17T00:00:00.000Z',
      updatedAt: '2026-07-17T00:00:00.000Z',
    })
    await interpreter.reconcile(doc, { width: 1200, height: 600 })
    expect(broker.diagnostics().durableRefCounts[Object.keys(broker.diagnostics().durableRefCounts)[0]!]).toBe(2)
    await interpreter.dispose()
  })
})
