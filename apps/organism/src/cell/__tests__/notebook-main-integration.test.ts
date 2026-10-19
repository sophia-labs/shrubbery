import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { GARDEN_DEFAULT, type WorkspaceConfig } from '@shrubbery/nucleus'
import { fragmentRegionsOf } from '../workspace-fragments.js'
import { withNotebookWorkspaceShell } from '../notebook-workspace-shell.js'

// Execute only the actual extracted caller/handler. Do not import main's eager
// app/engine bootstrap or pretend this is a browser encounter.
const text = readFileSync(resolve('src/main.ts'), 'utf8')
const source = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function callsNamed(node: ts.Node, name: string): ts.CallExpression[] {
  const result: ts.CallExpression[] = []
  const visit = (item: ts.Node) => {
    if (ts.isCallExpression(item) && item.expression.getText(source) === name) result.push(item)
    ts.forEachChild(item, visit)
  }
  visit(node)
  return result
}
const shell = (): WorkspaceConfig => ({ id: 'AgentNotebookWorkspace', label: 'Agent Notebook', renderedByComponent: 'app-shell',
  regions: { 'region-center': { ...GARDEN_DEFAULT.regions['region-center'], childRegion: null, order: 0, docksPanel: [],
    renderedByComponent: 'sh-layout-dashboard', fragmentSurface: 'urn:sophia:ux:surface:agent-notebook:fixture' } },
  panels: {}, dimensions: {}, rootRegions: ['region-center'] })

describe('actual main notebook caller composition', () => {
  it('selects the temporary view before fragment discovery, with every explicit center route represented', () => {
    const render = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'renderConfig')!
    const wrapper = callsNamed(render, 'withNotebookWorkspaceShell')
    const fragments = callsNamed(render, 'currentFragmentOptions')
    expect(wrapper).toHaveLength(1)
    expect(fragments).toHaveLength(1)
    expect(wrapper[0].pos).toBeLessThan(fragments[0].pos)
    const original = shell()
    // `files`: the Files center route (CONTRACT-files rudiments, 2026-10-05) is an explicit route like the others.
    // `workflowPlan`: a workflow's plan in the main pane (2026-10-18) is one too.
    const fields = ['openDocId', 'centerPanesVisible', 'tagLens', 'zoteroSource', 'artifactSurface', 'docHistorySurface', 'contested', 'parkedWork', 'files', 'workflowPlan']
    const route = (active?: string) => {
      const context: Record<string, unknown> = { config: original, withNotebookWorkspaceShell }
      for (const field of fields) context[field] = field === active ? 'present' : null
      return runInNewContext(wrapper[0].getText(source), context) as WorkspaceConfig
    }
    expect(fragmentRegionsOf(route())).toHaveLength(1)
    for (const field of fields) expect(fragmentRegionsOf(route(field)), field).toEqual([])
    expect(fragmentRegionsOf(original)).toHaveLength(1)
  })

  it('executes the actual Home handler and clears history/contested/parked routes as well as normal document surfaces', () => {
    const call = callsNamed(source, 'hostEl.addEventListener').find(call => ts.isStringLiteral(call.arguments[0]) && call.arguments[0].text === 'mn-navigate-home')!
    const clearDocHistoryState = vi.fn(() => { context.currentDocHistorySurface = null })
    const rerenderCurrentSource = vi.fn()
    let filesLeft = 0
    const context = {
      filesShell: { leave: () => { filesLeft += 1 } },
      openDocId: 'doc', currentGraphId: 'graph', currentSidebarSelectedId: 'selected', currentInspectorSelection: null,
      currentDocHistorySurface: { documentId: 'doc' } as object | null,
      currentContestedSurface: { graphId: 'graph' } as object | null,
      currentParkedWorkRoute: { graphId: 'graph' } as object | null,
      closeOpenDocumentSurface: vi.fn(), clearTagLensState: vi.fn(), clearZoteroSourceState: vi.fn(), clearArtifactSurfaceState: vi.fn(),
      clearDocHistoryState, rerenderCurrentSource, ok: vi.fn(),
    }
    const script = ts.transpileModule(`const handler = ${call.arguments[1].getText(source)}; handler();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(script, context)
    expect(clearDocHistoryState).toHaveBeenCalledTimes(1)
    expect(context.currentDocHistorySurface).toBeNull()
    expect(context.currentContestedSurface).toBeNull()
    expect(context.currentParkedWorkRoute).toBeNull()
    expect(context.currentSidebarSelectedId).toBeNull()
    expect(rerenderCurrentSource).toHaveBeenCalledTimes(1)
    expect(filesLeft).toBe(1)                       // Home closes the Files route too
  })
})
