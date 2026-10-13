import { describe, expect, it } from 'vitest'
import {
  GARDEN_DEFAULT, deriveAppTabs, planFor, resolveSurfaceTag,
  serializeConfigToTriples, validateConfig, type WorkspaceConfig,
} from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import { fragmentRegionsOf } from '../workspace-fragments.js'
import { withNotebookWorkspaceShell } from '../notebook-workspace-shell.js'

const surfaceIri = 'urn:sophia:ux:surface:agent-notebook:synthetic-notebook'
function bareNotebook(): WorkspaceConfig {
  return {
    id: 'AgentNotebookWorkspace', label: 'Agent Notebook Workspace', renderedByComponent: 'app-shell',
    regions: {
      'region-center': {
        ...GARDEN_DEFAULT.regions['region-center'],
        childRegion: null, order: 0, docksPanel: [], sizeFraction: 0.99,
        renderedByComponent: 'sh-layout-dashboard', label: 'Agent Notebook', fragmentSurface: surfaceIri,
      },
    },
    panels: {}, dimensions: {}, rootRegions: ['region-center'],
  }
}

describe('bare notebook host shell compatibility', () => {
  it('keeps a valid notebook center inside the canonical navigation and status frame', () => {
    const input = bareNotebook()
    expect(validateConfig(input)).toEqual({ ok: true })
    const config = withNotebookWorkspaceShell(input)
    expect(validateConfig(config)).toEqual({ ok: true })
    const plan = planFor(config)
    expect(plan.topChrome).toEqual(['region-top-bar'])
    expect(plan.bottomChrome).toEqual(['region-bottom-bar'])
    expect(plan.spineHeadId).toBe('region-left-rail')
    expect(resolveSurfaceTag(config, 'region-left-rail')).toBe('mn-sidebar-panel')
    expect(resolveSurfaceTag(config, 'region-center')).toBe('sh-layout-dashboard')
    expect(config.regions['region-center'].fragmentSurface).toBe(surfaceIri)
    expect(fragmentRegionsOf(config)).toEqual([{ regionId: 'region-center', surfaceIri }])
    expect(deriveAppTabs(config)).toEqual(['garden'])
  })

  it('renders real top, bottom and sidebar components without replacing the notebook fragment', () => {
    const host = renderWorkspace(withNotebookWorkspaceShell(bareNotebook()))
    expect(host.querySelector('mn-top-bar')).not.toBeNull()
    expect(host.querySelector('mn-bottom-bar')).not.toBeNull()
    expect(host.querySelector('mn-sidebar-panel')).not.toBeNull()
    expect(host.querySelector('sh-layout-dashboard')).not.toBeNull()
  })

  it('adds only the sidebar open edge, not links to absent inspector or graph panels', () => {
    expect(withNotebookWorkspaceShell(bareNotebook()).edges).toEqual([
      { from: 'face:sidebar', to: 'face:editor', predicate: 'navigatesTo' },
    ])
  })

  it('lets an explicit host route own the center, then returns to the original notebook', () => {
    const input = bareNotebook()
    const notebook = withNotebookWorkspaceShell(input)
    const routed = withNotebookWorkspaceShell(input, { preferHostRoute: true })
    expect(validateConfig(routed)).toEqual({ ok: true })
    expect(resolveSurfaceTag(routed, 'region-center')).toBe('mn-document-editor')
    expect(fragmentRegionsOf(routed)).toEqual([])
    expect(routed.regions['region-center'].childRegion).toBeNull()
    expect(withNotebookWorkspaceShell(input)).toBe(notebook)
    expect(fragmentRegionsOf(withNotebookWorkspaceShell(input))).toEqual([{ regionId: 'region-center', surfaceIri }])
  })

  it('does not alter the input, its serialized graph config, or the canonical defaults', () => {
    const input = bareNotebook()
    const before = JSON.stringify(input)
    const triples = serializeConfigToTriples(input)
    const defaults = JSON.stringify(GARDEN_DEFAULT)
    withNotebookWorkspaceShell(input)
    withNotebookWorkspaceShell(input, { preferHostRoute: true })
    expect(JSON.stringify(input)).toBe(before)
    expect(serializeConfigToTriples(input)).toEqual(triples)
    expect(JSON.stringify(GARDEN_DEFAULT)).toBe(defaults)
  })

  it('is identity-stable and idempotent for repeated renders', () => {
    const input = bareNotebook()
    const framed = withNotebookWorkspaceShell(input)
    expect(withNotebookWorkspaceShell(input)).toBe(framed)
    expect(withNotebookWorkspaceShell(framed)).toBe(framed)
    expect(withNotebookWorkspaceShell(input, { preferHostRoute: true })).toBe(
      withNotebookWorkspaceShell(input, { preferHostRoute: true }),
    )
  })

  it.each([
    ['ordinary Garden', () => GARDEN_DEFAULT],
    ['another fullscreen workspace', () => ({ ...bareNotebook(), id: 'CustomFullscreen' })],
    ['another app host', () => ({ ...bareNotebook(), renderedByComponent: 'custom-host' })],
    ['existing authored chrome', () => {
      const c = bareNotebook()
      return { ...c, regions: { ...c.regions, 'region-top-bar': GARDEN_DEFAULT.regions['region-top-bar'] },
        rootRegions: ['region-top-bar', 'region-center'] }
    }],
    ['other fragment kind', () => {
      const c = bareNotebook()
      return { ...c, regions: { 'region-center': { ...c.regions['region-center'], fragmentSurface: 'urn:custom:surface' } } }
    }],
    ['authored app branches', () => ({ ...bareNotebook(), appRootRegions: { custom: ['region-center'] } })],
    ['authored panels', () => ({ ...bareNotebook(), panels: { 'panel-sidebar': GARDEN_DEFAULT.panels['panel-sidebar'] } })],
    ['authored edges', () => ({ ...bareNotebook(), edges: GARDEN_DEFAULT.edges })],
    ['explicit configured mode', () => {
      const c = bareNotebook()
      return { ...c, regions: { 'region-center': { ...c.regions['region-center'], surfaceMode: 'configured' as const } } }
    }],
  ] as const)('leaves %s untouched', (_name, make) => {
    const input = make()
    expect(withNotebookWorkspaceShell(input)).toBe(input)
    expect(withNotebookWorkspaceShell(input, { preferHostRoute: true })).toBe(input)
  })
})
