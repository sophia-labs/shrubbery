import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderHandle } from '@shrubbery/nucleus'
import { synchronizedCrdtProviderLifecycle } from '@shrubbery/nucleus'
import { createShellContext } from '../shell-context.js'
import {
  createShellFeatureHost,
  type ShellFeature,
} from '../shell-feature-host.js'

interface FakeContract {
  readonly name: string
}

function fakeProvider(): ProviderHandle {
  return {
    doc: {},
    awareness: {},
    lifecycle: synchronizedCrdtProviderLifecycle(),
    whenRenderable: Promise.resolve(),
    whenEditable: Promise.resolve(),
    whenSynced: Promise.resolve(),
    renderSource: Promise.resolve('live'),
    destroy: vi.fn(),
  } as unknown as ProviderHandle
}

function context(contract: FakeContract | null = { name: 'cell-a' }) {
  const host = document.createElement('main')
  document.body.append(host)
  return createShellContext({
    host,
    graphId: 'graph-a',
    documentId: 'doc-a',
    app: 'garden',
    source: 'CELL_LIVE',
    deploymentMode: 'hosted',
    contract,
    location: new URL('https://garden.test/settings?section=account'),
    rerender: vi.fn(),
  })
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('shell context', () => {
  it('captures an immutable value snapshot while retaining explicit capabilities', () => {
    const sourceLocation = new URL('https://garden.test/g/graph-a/doc-a')
    const rerender = vi.fn()
    const host = document.createElement('main')
    const shell = createShellContext({
      host,
      graphId: 'graph-a',
      documentId: 'doc-a',
      app: 'garden',
      source: 'CELL_LIVE',
      deploymentMode: 'playground',
      contract: { name: 'loopback' },
      location: sourceLocation,
      rerender,
    })

    sourceLocation.pathname = '/changed-after-snapshot'
    shell.rerender()

    expect(Object.isFrozen(shell)).toBe(true)
    expect(shell.location.pathname).toBe('/g/graph-a/doc-a')
    expect(shell).toMatchObject({
      host,
      graphId: 'graph-a',
      documentId: 'doc-a',
      app: 'garden',
      source: 'CELL_LIVE',
      deploymentMode: 'playground',
      contract: { name: 'loopback' },
    })
    expect(rerender).toHaveBeenCalledOnce()
  })
})

describe('shell feature host', () => {
  it('composes workspace and route snapshots in registration order', () => {
    const seen: string[] = []
    const close = vi.fn()
    const features: ShellFeature<FakeContract>[] = [
      {
        id: 'first',
        workspaceSnapshot(shell, snapshot) {
          seen.push(`workspace:first:${shell.graphId}:${String(snapshot.rightCollapsed)}`)
          return {
            rightCollapsed: true,
            chrome: { activeApp: 'garden' },
          }
        },
        routeOptions(_shell, options) {
          seen.push(`route:first:${String(options.onClose === undefined)}`)
          return { onClose: close }
        },
      },
      {
        id: 'second',
        workspaceSnapshot(_shell, snapshot) {
          seen.push(`workspace:second:${String(snapshot.rightCollapsed)}`)
          return {
            chrome: {
              ...snapshot.chrome,
              leftPanelMode: 'graph',
            },
          }
        },
        routeOptions(_shell, options) {
          seen.push(`route:second:${String(options.onClose === close)}`)
          return { opsHealthPollIntervalMs: 1234 }
        },
      },
    ]
    const featureHost = createShellFeatureHost(features)
    const shell = context()

    const workspace = featureHost.workspaceSnapshot(shell, { rightCollapsed: false })
    const routes = featureHost.routeOptions(shell, {})

    expect(workspace).toMatchObject({
      rightCollapsed: true,
      chrome: { activeApp: 'garden', leftPanelMode: 'graph' },
    })
    expect(routes).toMatchObject({
      onClose: close,
      opsHealthPollIntervalMs: 1234,
    })
    expect(seen).toEqual([
      'workspace:first:graph-a:false',
      'workspace:second:true',
      'route:first:true',
      'route:second:true',
    ])
  })

  it('binds provider claims, observes the rendered Happy DOM, and tears down in reverse order', () => {
    const lifecycle: string[] = []
    const clicked = vi.fn()
    const button = document.createElement('button')
    button.id = 'feature-action'
    const shell = context()
    shell.host.append(button)
    const provider = fakeProvider()

    const makeFeature = (id: string): ShellFeature<FakeContract> => ({
      id,
      bindProvider(boundProvider, boundContext) {
        expect(boundProvider).toBe(provider)
        lifecycle.push(`bind:${id}:${boundContext.documentId}`)
        return () => lifecycle.push(`unbind:${id}`)
      },
      afterWorkspaceRender(renderContext) {
        lifecycle.push(`render:${id}`)
        if (id === 'first') {
          renderContext.host.querySelector<HTMLButtonElement>('#feature-action')
            ?.addEventListener('click', clicked, { once: true })
        }
      },
      destroy() {
        lifecycle.push(`destroy:${id}`)
      },
    })

    const featureHost = createShellFeatureHost([
      makeFeature('first'),
      makeFeature('second'),
    ])
    const unbind = featureHost.bindProvider(provider, shell)
    featureHost.afterWorkspaceRender(shell, {})
    button.click()
    unbind()
    unbind()
    featureHost.destroy()
    featureHost.destroy()

    expect(clicked).toHaveBeenCalledOnce()
    expect(lifecycle).toEqual([
      'bind:first:doc-a',
      'bind:second:doc-a',
      'render:first',
      'render:second',
      'unbind:second',
      'unbind:first',
      'destroy:second',
      'destroy:first',
    ])
  })

  it('rolls back partial provider bindings and rejects ambiguous feature ids', () => {
    const cleanup = vi.fn()
    const failure = new Error('bind failed')
    const shell = context()
    const provider = fakeProvider()
    const featureHost = createShellFeatureHost<FakeContract>([
      { id: 'bound', bindProvider: () => cleanup },
      { id: 'failure', bindProvider: () => { throw failure } },
    ])

    expect(() => featureHost.bindProvider(provider, shell)).toThrow(failure)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(() => createShellFeatureHost([{ id: 'same' }, { id: 'same' }]))
      .toThrow('Duplicate Organism shell feature id: same')
  })

  it('cleans active provider bindings during final destruction', () => {
    const cleanup = vi.fn()
    const shell = context()
    const featureHost = createShellFeatureHost<FakeContract>([
      { id: 'provider-owner', bindProvider: () => cleanup },
    ])

    featureHost.bindProvider(fakeProvider(), shell)
    featureHost.destroy()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(() => featureHost.workspaceSnapshot(shell, {}))
      .toThrow('Organism shell feature host has been destroyed')
  })
})
