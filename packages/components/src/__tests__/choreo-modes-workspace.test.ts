import { afterEach, describe, expect, it } from 'vitest'
import '../choreo-modes-surface.js'
import type { ChoreoModesSurface } from '../choreo-modes-surface.js'
import type { ChoreoModesPort } from '../choreo-modes-model.js'

const mode = {
  iri: 'urn:sophia:mode:reader', slug: 'reader', label: 'Reader', access: 'read' as const,
  allowsTools: ['read_document', 'write_document'], graphScopes: [], requiresApproval: [], imageTransform: null,
}

const port: ChoreoModesPort = {
  graphId: 'test-graph',
  async catalogue() {
    return [
      { name: 'read_document', description: 'Read a document and return its current text.', scopes: ['documents.read'], effect: 'read' as const, family: 'documents' },
      { name: 'write_document', description: 'Change document text.', scopes: ['documents.write'], effect: 'write' as const, family: 'documents' },
    ]
  },
  async load() { return { modes: [mode], agents: [] } },
  async saveMode() {}, async deleteMode() {}, async saveAgentModes() {},
}

afterEach(() => { document.body.replaceChildren() })

describe('Choreograph workspace', () => {
  it('shows configuration state separately from source-backed run history', async () => {
    const el = document.createElement('choreo-modes-surface') as ChoreoModesSurface
    el.port = port
    el.runOverviewPort = { async runs() { return { kind: 'ok', runs: [{
      runId: 'run-1', workflowName: 'Research workflow', status: 'completed',
      startedAt: '2026-09-23T12:00:00Z', endedAt: '2026-09-23T12:00:01Z', durationMs: 1234,
      totalTokens: 12345, agentCount: 2,
    }] } } }
    document.body.append(el)
    await el.reload()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('[aria-label="Workspace configuration summary"]')?.textContent).toContain('1/2')
    expect(el.shadowRoot!.querySelector('[aria-label="Recent workflow runs"]')?.textContent).toContain('Research workflow')
    expect(el.shadowRoot!.querySelector('[aria-label="Recent workflow runs"]')?.textContent).toContain('12,345 tokens')
    expect(el.shadowRoot!.querySelector('[aria-label="Loaded run metrics"]')?.textContent).toContain('12,345')
    expect(el.shadowRoot!.querySelector('[aria-label="Recent workflow runs"]')?.textContent).toContain('does not attribute them to modes')
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-run="run-1"]')!.click()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('[aria-label="Run details"]')?.textContent).toContain('1.2 s')
    expect(el.shadowRoot!.querySelector('[aria-label="Run details"]')?.textContent).toContain('12,345')
    expect(el.shadowRoot!.querySelector('[aria-label="Run details"]')?.textContent).toContain('no per-mode attribution')
  })

  it('exposes full descriptions and a bounded text estimate in the mode inspector', async () => {
    const el = document.createElement('choreo-modes-surface') as ChoreoModesSurface
    el.port = port
    document.body.append(el)
    await el.reload()
    await el.updateComplete
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-screen="modes"]')!.click()
    await el.updateComplete
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-mode="reader"]')!.click()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('[data-role="exposes"]')?.textContent).toContain('1 of 2')
    expect(el.shadowRoot!.querySelector('[data-role="estimate-method"]')?.textContent).toContain('UTF-8 bytes ÷ 4')
    expect(el.shadowRoot!.querySelector('.description-copy')?.textContent).toContain('Read a document and return its current text.')
    el.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Inspect write_document"]')!.click()
    await el.updateComplete
    expect(el.shadowRoot!.querySelector('[aria-label="Selected tool details"]')?.textContent).toContain('Blocked by access')
  })
})
