// @vitest-environment happy-dom
/**
 * Hoja QA 2026-09-23: after a deep link / reload the workspace <select> showed
 * the FIRST workspace while the list and the top bar were another graph's, and
 * choosing the displayed row did nothing. The displayed row must always be the
 * graph Hoja is reading.
 */
import type { GatewayGraphInfo, GatewayMcpResult } from '@shrubbery/source/gateway'
import type { CognitoAuthSession } from '@shrubbery/source/gateway'
import { OPERATOR_SUBJECTS } from '@shrubbery/source/features'
import { afterEach, describe, expect, it } from 'vitest'
import '@shrubbery/components/top-bar'
import { CellStore, type CellStoreGateway } from '../src/cell-store.js'
import { HojaApp } from '../src/hoja-app.js'

afterEach(() => { document.body.replaceChildren() })

describe('Hoja workspace picker shows the workspace being read', () => {
  it('a deep link to the second workspace displays that workspace, not the first', async () => {
    const read: string[] = []
    const app = await mountAt('garden-b', read)
    const select = workspaceSelect(app)
    expect(read.every(graphId => graphId === 'garden-b')).toBe(true)
    expect(select.value).toBe('garden-b')
    expect(select.selectedOptions[0]?.textContent?.trim()).toBe('Garden B')
    expect([...select.options].map(option => option.value)).toEqual(['garden-a', 'garden-b', 'garden-c'])
  })

  it('choosing another workspace moves both the display and the reads', async () => {
    const read: string[] = []
    const app = await mountAt('garden-b', read)
    const select = workspaceSelect(app)
    select.value = 'garden-c'
    select.dispatchEvent(new Event('change'))
    await settle(app)
    expect(workspaceSelect(app).value).toBe('garden-c')
    expect(read.at(-1)).toBe('garden-c')
  })

  it('carries the workspace to Garden and Choreograph as ?graph=', async () => {
    const app = await mountAt('garden-b', [])
    const assigned: string[] = []
    const original = window.location.assign
    Object.defineProperty(window.location, 'assign', { configurable: true, value: (href: string) => { assigned.push(href) } })
    try {
      const bar = app.shadowRoot!.querySelector('mn-top-bar')!
      for (const id of ['garden', 'choreograph']) {
        bar.shadowRoot!.querySelector<HTMLButtonElement>(`.app-switcher-btn[data-app-id="${id}"]`)!.click()
        await settle(app)
      }
    } finally {
      Object.defineProperty(window.location, 'assign', { configurable: true, value: original })
    }
    expect(assigned.map(href => new URL(href).searchParams.get('graph'))).toEqual(['garden-b', 'garden-b'])
    expect(assigned.map(href => new URL(href).pathname)).toEqual(['/', '/choreograph'])
  })
})

async function mountAt(graphId: string, read: string[]): Promise<HojaApp> {
  const gateway: CellStoreGateway = {
    async graphs() { return [graph('garden-a', 'Garden A'), graph('garden-b', 'Garden B'), graph('garden-c', 'Garden C')] },
    async toolsCall(requested, tool) {
      read.push(requested)
      if (tool === 'get_workspace') return result({ documents: [], folders: [], page: { complete: true, nextCursor: null } })
      throw new Error(`unexpected tool ${tool}`)
    },
  }
  const app = new HojaApp()
  app.store = new CellStore({ gateway, storage: null, location: new URL(`https://garden.test/hoja/?graph=${graphId}`) })
  app.authSession = session(OPERATOR_SUBJECTS[0]!)
  document.body.append(app)
  await settle(app)
  return app
}

async function settle(app: HojaApp): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await app.updateComplete
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  await app.shadowRoot?.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>('mn-top-bar')?.updateComplete
}

function workspaceSelect(app: HojaApp): HTMLSelectElement {
  return app.shadowRoot!.querySelector<HTMLSelectElement>('[data-testid="select.workspace"]')!
}

function graph(graphId: string, title: string): GatewayGraphInfo {
  return { graphId, title, role: 'editor', cellState: 'running' } as GatewayGraphInfo
}

function result(value: unknown): GatewayMcpResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] } as GatewayMcpResult
}

function session(userId: string): CognitoAuthSession {
  return {
    snapshot: () => ({ status: 'authenticated', userId }),
    onChange: () => () => undefined,
    whenReady: async () => undefined,
    signIn: async () => undefined,
    signOut: async () => undefined,
  } as unknown as CognitoAuthSession
}
