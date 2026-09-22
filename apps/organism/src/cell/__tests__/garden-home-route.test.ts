import { afterEach, describe, expect, it, vi } from 'vitest'
import '@shrubbery/components'
import type {
  MnGardenHome,
  MnWorkspaceSummary,
} from '@shrubbery/components'
import {
  gardenGraphLocation,
  gardenGraphPath,
  mountGardenHomeRoute,
  type OrganismGardenHomeSnapshot,
} from '../garden-home-route.js'

const workspace: MnWorkspaceSummary = {
  graphId: 'koch / vera',
  title: 'Morse Garden',
  role: 'owner',
  cellState: 'running',
  lastOpenedAt: 1_721_510_400_000,
}

const snapshot: OrganismGardenHomeSnapshot = {
  account: { userId: 'vera', displayName: 'Vera', email: 'vera@example.test' },
  workspaces: [workspace],
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(settle => { resolve = settle })
  return { promise, resolve }
}

afterEach(() => document.body.replaceChildren())

describe('Garden Home route controller', () => {
  it('owns the shared encoded graph path grammar', () => {
    expect(gardenGraphPath('koch / vera')).toBe('/g/koch%20%2F%20vera')
    expect(gardenGraphLocation(new URL(
      'https://garden.example.test/g/koch%20%2F%20vera',
    ))).toEqual({ graphId: 'koch / vera' })
    expect(gardenGraphLocation(new URL('https://garden.example.test/home'))).toBeNull()
    expect(() => gardenGraphPath('  ')).toThrow('requires a graph id')
  })

  it('renders loading immediately, then projects the service snapshot into the controlled component', async () => {
    const gate = deferred()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountGardenHomeRoute(host, {
      async load() {
        await gate.promise
        return snapshot
      },
      openGraph() {},
    })
    const page = host.querySelector('mn-garden-home') as MnGardenHome
    await page.updateComplete
    expect(page.status).toBe('loading')

    gate.resolve()
    await mount.ready
    await page.updateComplete
    expect(page.status).toBe('ready')
    expect(page.account).toEqual(snapshot.account)
    expect(page.workspaces).toEqual([workspace])

    mount.destroy()
  })

  it('reflects graph intent progress and create failures without performing either effect itself', async () => {
    const graphGate = deferred()
    const opened: string[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountGardenHomeRoute(host, {
      async load() { return snapshot },
      async openGraph(graph) {
        opened.push(graph.graphId)
        await graphGate.promise
      },
      async create() {
        throw new Error('Graph quota reached')
      },
    })
    await mount.ready
    const page = host.querySelector('mn-garden-home') as MnGardenHome

    page.dispatchEvent(new CustomEvent('mn-garden-home-open-graph', {
      detail: { workspace },
      bubbles: true,
      composed: true,
    }))
    await page.updateComplete
    expect(page.busyGraphId).toBe(workspace.graphId)
    expect(opened).toEqual([workspace.graphId])
    graphGate.resolve()
    await vi.waitFor(() => expect(page.busyGraphId).toBeNull())

    page.dispatchEvent(new CustomEvent('mn-garden-home-create', {
      detail: {},
      bubbles: true,
      composed: true,
    }))
    await vi.waitFor(() => expect(page.createStatus).toBe('error'))
    expect(page.createError).toContain('quota')

    mount.destroy()
  })

  it('turns catalog failure into retryable state and reloads through the same service', async () => {
    let loads = 0
    const host = document.createElement('div')
    document.body.appendChild(host)
    const mount = mountGardenHomeRoute(host, {
      async load() {
        loads += 1
        if (loads === 1) throw new Error('Gateway catalog unavailable')
        return snapshot
      },
      openGraph() {},
    })
    await mount.ready
    const page = host.querySelector('mn-garden-home') as MnGardenHome
    await page.updateComplete
    expect(page.status).toBe('error')
    expect(page.error).toContain('Gateway catalog')

    page.dispatchEvent(new CustomEvent('mn-garden-home-refresh', { bubbles: true, composed: true }))
    await vi.waitFor(() => expect(page.status).toBe('ready'))
    expect(loads).toBe(2)

    mount.destroy()
  })
})
