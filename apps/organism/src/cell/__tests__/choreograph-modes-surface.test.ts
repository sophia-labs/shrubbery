/**
 * <choreo-modes-surface> driven through its real shadow DOM, over the real
 * ChoreographModesService, over a real SPARQL engine. Every assertion about a
 * write is an assertion about the stored triples.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@shrubbery/components'
import type { ChoreoModesSurface } from '@shrubbery/components'
import type { ShellContext } from '../shell-context.js'
import { ChoreographModesService } from '../choreograph-modes-service.js'
import { createChoreographModesFeature } from '../choreograph-modes-feature.js'
import { OxigraphMcpCell } from './choreograph-modes-cell.js'

const G = 'urn:mnemosyne:local:graph:graph-a:user:rdf'
const AGT = 'http://mnemosyne.dev/agent#'
const LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

function seeded(): OxigraphMcpCell {
  const cell = new OxigraphMcpCell()
  cell.store.update(`INSERT DATA {
    GRAPH <urn:mnemosyne:local:graph:graph-a:agents> {
      <urn:sophia:agent:scout> a <${AGT}Agent> ; <${LABEL}> "Scout" .
      <urn:sophia:agent:quill> a <${AGT}Agent> ; <${LABEL}> "Quill" .
    }
    GRAPH <${G}> {
      <urn:sophia:mode:reader> a <${AGT}Mode> ; <${LABEL}> "Reader" ; <${AGT}access> "read" ;
        <${AGT}allowsTool> "read_document", "search_documents" .
      <urn:sophia:mode:legacy> a <${AGT}Mode> ; <${LABEL}> "Legacy" ; <${AGT}access> "write" ;
        <${AGT}allowsTool> "read_document", "retired_tool" .
      <urn:sophia:agent:scout> <${AGT}defaultMode> <urn:sophia:mode:reader> ;
        <${AGT}mayUseMode> <urn:sophia:mode:reader> .
      <urn:sophia:agent:quill> <${AGT}mayUseMode> <urn:sophia:mode:reader> .
    }
  }`)
  return cell
}

async function mount(cell: OxigraphMcpCell): Promise<ChoreoModesSurface> {
  const surface = document.createElement('choreo-modes-surface')
  document.body.appendChild(surface)
  surface.graphIds = ['graph-a', 'sophia-cluster']
  surface.port = new ChoreographModesService(cell, 'graph-a')
  await vi.waitFor(() => {
    expect(surface.shadowRoot?.querySelector('[data-mode="reader"]')).not.toBeNull()
  })
  return surface
}

const $ = <T extends Element = HTMLElement>(surface: ChoreoModesSurface, selector: string): T => {
  const found = surface.shadowRoot!.querySelector<T>(selector)
  if (!found) throw new Error(`missing ${selector}`)
  return found
}

async function settle(surface: ChoreoModesSurface): Promise<void> {
  await surface.updateComplete
  await new Promise(resolve => setTimeout(resolve, 0))
  await surface.updateComplete
}

async function showModes(surface: ChoreoModesSurface): Promise<void> {
  await surface.updateComplete
  $(surface, '[data-screen="modes"]').click()
  await settle(surface)
}

async function showAgent(surface: ChoreoModesSurface, agentId: string): Promise<void> {
  await surface.updateComplete
  $(surface, '[data-screen="agents"]').click()
  await settle(surface)
  $(surface, `[data-agent-card="${agentId}"]`).click()
  await settle(surface)
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

function check(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked
  input.dispatchEvent(new Event('change'))
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('choreo-modes-surface — modes, editor, agents', () => {
  it('lists each mode with its tool count, access, and the agents using it', async () => {
    const surface = await mount(seeded())
    const reader = $(surface, '[data-mode="reader"]')
    expect(reader.querySelector('[data-access]')?.textContent).toBe('read')
    expect(reader.querySelector('[data-role="tool-count"]')?.textContent).toBe('2 tools')
    expect(reader.querySelector('[data-role="agents"]')?.textContent).toContain('Default for Scout')
    expect(reader.querySelector('[data-role="agents"]')?.textContent).toContain('Allowed for Quill')
    expect($(surface, '[data-mode="legacy"] [data-role="agents"]').textContent).toContain('No agents')
  })

  it('creates a mode: slug from the name, grouped live catalogue, read ceiling counting, approvals', async () => {
    const cell = seeded()
    const surface = await mount(cell)
    await showModes(surface)
    $(surface, '[data-action="new-mode"]').click()
    await settle(surface)

    type($<HTMLInputElement>(surface, 'input[name="label"]'), 'Field Researcher')
    await settle(surface)
    expect($(surface, '[data-role="iri"]').textContent).toBe('urn:sophia:mode:field-researcher')

    // Catalogue rows are sorted by family and show each tool's effect class.
    const families = [...surface.shadowRoot!.querySelectorAll('.tool-row .tool-ident small')]
      .map(row => row.textContent?.split(' · ')[0])
    expect([...new Set(families)]).toEqual(['documents', 'graphs', 'memory', 'rdf', 'search'])
    expect($(surface, '[data-tool="write_document"] .tool-ident small').textContent).toContain('write')
    expect($(surface, '[data-tool="read_document"] .tool-ident small').textContent).toContain('read')
    expect($(surface, '[data-role="exposes"]').textContent).toBe('Exposes 0 of 13 tools')

    check($<HTMLInputElement>(surface, '[data-tool="read_document"] input'), true)
    check($<HTMLInputElement>(surface, '[data-tool="semantic_search"] input'), true)
    check($<HTMLInputElement>(surface, '[data-tool="write_document"] input'), true)
    await settle(surface)
    // Read ceiling (the default): the write tool is chosen but not exposed.
    expect($(surface, '[data-role="exposes"]').textContent).toBe('Exposes 2 of 13 tools')
    expect($(surface, '[data-role="ineffective"]').textContent).toContain('write_document')
    expect($(surface, '[data-tool="write_document"]').dataset.effective).toBe('false')

    $(surface, '[data-access-option="write"]').click()
    await settle(surface)
    expect($(surface, '[data-role="exposes"]').textContent).toBe('Exposes 3 of 13 tools')

    type($<HTMLInputElement>(surface, 'input[name="scope"]'), 'sophia-cluster')
    $(surface, '[data-action="add-scope"]').click()
    await settle(surface)
    check($<HTMLInputElement>(surface, '[data-approval="write_document"] input'), true)
    await settle(surface)

    $(surface, '[data-action="save"]').click()
    await vi.waitFor(() => {
      expect(surface.shadowRoot?.querySelector('[data-mode="field-researcher"]')).not.toBeNull()
    })
    const m = '<urn:sophia:mode:field-researcher>'
    expect(cell.triples(G).filter(t => t.startsWith(m))).toEqual([
      `${m} <${AGT}access> "write"`,
      `${m} <${AGT}allowsTool> "read_document"`,
      `${m} <${AGT}allowsTool> "semantic_search"`,
      `${m} <${AGT}allowsTool> "write_document"`,
      `${m} <${AGT}graphScope> <urn:graph:sophia-cluster>`,
      `${m} <${AGT}requiresApproval> "write_document"`,
      `${m} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${AGT}Mode>`,
      `${m} <${LABEL}> "Field Researcher"`,
    ])
  })

  it('shows tools missing from the live catalogue and refuses to save until they are removed', async () => {
    const cell = seeded()
    const surface = await mount(cell)
    $(surface, '[data-mode="legacy"]').click()
    await settle(surface)
    expect($(surface, '[data-role="unknown-tools"]').textContent).toContain('retired_tool')
    expect($<HTMLButtonElement>(surface, '[data-action="save"]').disabled).toBe(true)

    $(surface, '[data-remove-tool="retired_tool"]').click()
    await settle(surface)
    expect(surface.shadowRoot!.querySelector('[data-role="unknown-tools"]')).toBeNull()
    expect($<HTMLButtonElement>(surface, '[data-action="save"]').disabled).toBe(false)
    $(surface, '[data-action="save"]').click()
    await vi.waitFor(() => {
      expect(cell.triples(G).some(t => t.includes('retired_tool'))).toBe(false)
    })
    expect(cell.triples(G)).toContain(`<urn:sophia:mode:legacy> <${AGT}allowsTool> "read_document"`)
  })

  it('assigns modes to agents, keeping the default inside the allowed set', async () => {
    const cell = seeded()
    const surface = await mount(cell)
    await showAgent(surface, 'quill')
    const quill = () => $(surface, '[data-agent="quill"]')
    const defaultSelect = () => quill().querySelector<HTMLSelectElement>('[data-role="default"]')!
    // Only allowed modes are offered as the default.
    expect([...defaultSelect().options].map(o => o.textContent)).toEqual(['None', 'Reader'])

    check(quill().querySelector<HTMLInputElement>('[data-allowed="legacy"] input')!, true)
    await settle(surface)
    expect([...defaultSelect().options].map(o => o.textContent)).toEqual(['None', 'Legacy', 'Reader'])
    defaultSelect().value = 'urn:sophia:mode:legacy'
    defaultSelect().dispatchEvent(new Event('change'))
    await settle(surface)

    // Dropping the default from the allowed set clears the default.
    check(quill().querySelector<HTMLInputElement>('[data-allowed="legacy"] input')!, false)
    await settle(surface)
    expect(defaultSelect().value).toBe('')
    check(quill().querySelector<HTMLInputElement>('[data-allowed="legacy"] input')!, true)
    await settle(surface)
    defaultSelect().value = 'urn:sophia:mode:legacy'
    defaultSelect().dispatchEvent(new Event('change'))
    await settle(surface)

    quill().querySelector<HTMLButtonElement>('[data-action="save-agent"]')!.click()
    await vi.waitFor(() => {
      expect(cell.triples(G).filter(t => t.startsWith('<urn:sophia:agent:quill>'))).toEqual([
        `<urn:sophia:agent:quill> <${AGT}defaultMode> <urn:sophia:mode:legacy>`,
        `<urn:sophia:agent:quill> <${AGT}mayUseMode> <urn:sophia:mode:legacy>`,
        `<urn:sophia:agent:quill> <${AGT}mayUseMode> <urn:sophia:mode:reader>`,
      ])
    })
  })

  it('deletes a mode after confirmation, removing agent references', async () => {
    const cell = seeded()
    const surface = await mount(cell)
    $(surface, '[data-mode="reader"]').click()
    await settle(surface)
    $(surface, '[data-action="delete"]').click()
    await settle(surface)
    $(surface, '[data-action="confirm-delete"]').click()
    await vi.waitFor(() => {
      expect(surface.shadowRoot?.querySelector('[data-mode="reader"]')).toBeNull()
    })
    expect(cell.triples(G).some(t => t.includes('urn:sophia:mode:reader'))).toBe(false)
    await showAgent(surface, 'scout')
    expect($(surface, '[data-agent="scout"] [data-role="default"]').getAttribute('disabled')).not.toBeNull()
  })

  it('reports a failed catalogue and blocks saving instead of guessing', async () => {
    const cell = seeded()
    const surface = document.createElement('choreo-modes-surface')
    document.body.appendChild(surface)
    surface.port = new ChoreographModesService({ callTool: (name, args) => cell.callTool(name, args) }, 'graph-a')
    await showModes(surface)
    await vi.waitFor(() => {
      expect(surface.shadowRoot?.querySelector('[data-role="catalogue-error"]')?.textContent).toContain('tools/list')
    })
    $(surface, '[data-action="new-mode"]').click()
    await settle(surface)
    type($<HTMLInputElement>(surface, 'input[name="label"]'), 'Anything')
    await settle(surface)
    expect($<HTMLButtonElement>(surface, '[data-action="save"]').disabled).toBe(true)
  })
})

describe('createChoreographModesFeature — the workspace app seam', () => {
  it('hands the stamped surface a port for the active graph, and drops it off the Choreograph app', async () => {
    const cell = seeded()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const surface = document.createElement('choreo-modes-surface')
    host.appendChild(surface)
    const feature = createChoreographModesFeature()
    const contract = { rawMcp: cell, gateway: { graphs: async () => [{ graphId: 'graph-a' }, { graphId: 'graph-b' }, { graphId: 'bad id' }] } }
    const context = (app: 'choreograph' | 'garden', graphId: string): ShellContext => ({
      host, graphId, documentId: null, app, source: 'gardend', deploymentMode: 'local',
      contract,
      location: new URL('https://example.test/'), rerender: () => {},
    } as unknown as ShellContext)

    feature.afterWorkspaceRender!(context('choreograph', 'graph-a'), {} as never)
    const first = surface.port
    expect(first?.graphId).toBe('graph-a')
    await vi.waitFor(() => { expect(surface.graphIds).toEqual(['graph-a', 'graph-b']) })
    // Re-render with nothing changed keeps the same port (no reload churn).
    feature.afterWorkspaceRender!(context('choreograph', 'graph-a'), {} as never)
    expect(surface.port).toBe(first)
    feature.afterWorkspaceRender!(context('choreograph', 'graph-b'), {} as never)
    expect(surface.port?.graphId).toBe('graph-b')
    // Leaving the Choreograph app releases the binding; coming back rebinds.
    feature.afterWorkspaceRender!(context('garden', 'graph-b'), {} as never)
    feature.afterWorkspaceRender!(context('choreograph', 'graph-b'), {} as never)
    expect(surface.port?.graphId).toBe('graph-b')
    feature.destroy!()
  })
})
