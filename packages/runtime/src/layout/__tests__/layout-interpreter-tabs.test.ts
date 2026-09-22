import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LayoutInterpreter } from '../layout-interpreter.js'
import { buildTestBroker, buildTestRegistry, documentDescriptor, freshDocument, leafNode, mediaDescriptor } from './fixtures.js'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => root.remove())

describe('LayoutInterpreter tabs', () => {
  it('renders a direct root strip with safe text and active content below it', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const requests: unknown[] = []
    const interpreter = new LayoutInterpreter(root, { registry, broker, onTabActivate: (request) => requests.push(request) })
    const doc = freshDocument('T', {
      T: { kind: 'tabs', id: 'T', tabs: [{ nodeId: 'a', label: '<img src=x onerror=alert(1)>' }, { nodeId: 'b', label: 'B' }], activeNodeId: 'a', tabsRevision: 0 },
      a: leafNode('a', documentDescriptor('a')),
      b: leafNode('b', mediaDescriptor('urn:test:b')),
    })

    expect((await interpreter.reconcile(doc, { width: 800, height: 600 })).ok).toBe(true)
    const strip = interpreter.tabsStripElement('T')
    expect(strip?.parentElement).toBe(root)
    expect(strip?.getAttribute('role')).toBe('tablist')
    expect(strip?.querySelectorAll('button')).toHaveLength(2)
    expect(strip?.querySelector('img')).toBeNull()
    expect(strip?.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(interpreter.leafWrapperElement('a')?.style.top).toBe('32px')

    const second = strip?.querySelector<HTMLButtonElement>('[data-layout-tab-node-id="b"]')
    second?.click()
    expect(requests).toEqual([{ tabsId: 'T', nodeId: 'b', source: 'pointer' }])
  })

  it('moves keyboard focus without activation for arrows and activates on Enter', async () => {
    const { registry } = buildTestRegistry()
    const { broker } = buildTestBroker()
    const requests: unknown[] = []
    const interpreter = new LayoutInterpreter(root, { registry, broker, onTabActivate: (request) => requests.push(request) })
    const doc = freshDocument('T', {
      T: { kind: 'tabs', id: 'T', tabs: [{ nodeId: 'a', label: 'A' }, { nodeId: 'b', label: 'B' }], activeNodeId: 'a', tabsRevision: 0 },
      a: leafNode('a', documentDescriptor('a')),
      b: leafNode('b', mediaDescriptor('urn:test:b')),
    })
    await interpreter.reconcile(doc, { width: 800, height: 600 })
    const button = interpreter.tabsStripElement('T')?.querySelector<HTMLButtonElement>('[data-layout-tab-node-id="a"]')
    button?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement?.getAttribute('data-layout-tab-node-id')).toBe('b')
    expect(requests).toEqual([])
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(requests).toEqual([{ tabsId: 'T', nodeId: 'b', source: 'keyboard' }])
  })
})
