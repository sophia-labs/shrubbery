/**
 * sophia-home-face.test.ts — proves the gap this face closes: without it,
 * `LAY-010`'s replacement descriptor (`createSophiaHomeDescriptor()`) would
 * hit `FaceRegistry.validate`'s `unregistered-face` branch and paint an error
 * box, not an honest empty pane. Real `FaceRegistry` + `LayoutResourceBroker`
 * + `LayoutInterpreter` throughout — no test doubles for the machinery under
 * test, only for the surrounding document.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  createSophiaHomeDescriptor,
  deepFreeze,
  SOPHIA_HOME_FACE_ID,
  SOPHIA_HOME_RESOURCE,
  type LayoutDocument,
} from '@shrubbery/nucleus/layout'
import { FaceRegistry } from '../../face-registry.js'
import { LayoutResourceBroker } from '../../resource-broker.js'
import { LayoutInterpreter } from '../../layout-interpreter.js'
import { createSophiaHomeFace, createSophiaHomeResourceAdapter } from '../sophia-home-face.js'
import '../home-view-element.js'

function homeOnlyDocument(): LayoutDocument {
  return deepFreeze({
    schemaVersion: 1,
    layoutId: 'home-only',
    scope: 'session',
    graphId: null,
    rootNodeId: 'a',
    nodes: {
      a: { kind: 'leaf', id: 'a', descriptor: createSophiaHomeDescriptor(), descriptorRevision: 0 },
    },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  })
}

function buildRealInterpreter(root: HTMLElement): LayoutInterpreter {
  const registry = new FaceRegistry()
  registry.register(createSophiaHomeFace())
  const broker = new LayoutResourceBroker()
  broker.registerAdapter(createSophiaHomeResourceAdapter())
  return new LayoutInterpreter(root, { registry, broker })
}

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('div')
  document.body.appendChild(root)
})

afterEach(() => {
  root.remove()
})

describe('sophia.home face — the closed catalog knows about its own well-known face id', () => {
  it('faceId matches the exact Phase-1 constant, not a hand-typed string', () => {
    expect(createSophiaHomeFace().faceId).toBe(SOPHIA_HOME_FACE_ID)
    expect(SOPHIA_HOME_FACE_ID).toBe('sophia.home')
  })

  it('accepts() only the frozen SOPHIA_HOME_RESOURCE, not an arbitrary iri (defense in depth)', () => {
    const face = createSophiaHomeFace()
    expect(face.accepts(SOPHIA_HOME_RESOURCE)).toBe(true)
    expect(face.accepts({ kind: 'iri', iri: 'urn:not:home' })).toBe(false)
    expect(face.accepts({ kind: 'document', graphId: 'g', documentId: 'd' })).toBe(false)
  })
})

describe('sophia.home face — real interpreter mount, the LAY-010 gap this closes', () => {
  it('mounts an honest empty pane instead of an unregistered-face error box', async () => {
    const interpreter = buildRealInterpreter(root)
    const result = await interpreter.reconcile(homeOnlyDocument(), { width: 400, height: 300 })
    expect(result.ok).toBe(true)

    const wrapper = interpreter.leafWrapperElement('a')
    expect(wrapper).not.toBeNull()
    // NOT the error path.
    expect(wrapper!.hasAttribute('data-layout-error-reason')).toBe(false)
    expect(wrapper!.querySelector('[data-layout-error]')).toBeNull()

    // A real, mounted sh-home-view — content, not a placeholder error string.
    const view = wrapper!.querySelector('sh-home-view')
    expect(view).not.toBeNull()
    expect(interpreter.mountedView('a')).not.toBeNull()

    await interpreter.dispose()
  })

  it('the broker actually acquired the trivial home resource (not skipped)', async () => {
    const registry = new FaceRegistry()
    registry.register(createSophiaHomeFace())
    const broker = new LayoutResourceBroker()
    broker.registerAdapter(createSophiaHomeResourceAdapter())
    const interpreter = new LayoutInterpreter(root, { registry, broker })

    await interpreter.reconcile(homeOnlyDocument(), { width: 400, height: 300 })
    expect(broker.diagnostics().outstandingLeases).toBe(1)
    const homeIri = SOPHIA_HOME_RESOURCE.kind === 'iri' ? SOPHIA_HOME_RESOURCE.iri : ''
    // Namespaced by adapter identity (diff-review r2 WRONG's "namespace
    // cache keys by adapter identity" companion fix) — resource-broker.ts
    // wraps the adapter's own raw resourceKey() in an adapter-id-qualified
    // tuple before it reaches diagnostics().
    expect(Object.keys(broker.diagnostics().durableRefCounts)).toEqual([
      JSON.stringify(['sophia.home.marker', JSON.stringify(['iri', homeIri])]),
    ])

    await interpreter.dispose()
    expect(broker.diagnostics().outstandingLeases).toBe(0)
  })

  it('focus() reaches a real focusable element', async () => {
    const interpreter = buildRealInterpreter(root)
    await interpreter.reconcile(homeOnlyDocument(), { width: 400, height: 300 })
    const ok = await interpreter.focus('a', 'activate')
    expect(ok).toBe(true)
    await interpreter.dispose()
  })
})

describe('sophia.home face — genuinely no CRDT/provider machinery', () => {
  it('the face module source carries no CRDT/provider tokens', () => {
    // node:path/node:url, not the ambient (happy-dom-shadowed) global `URL` —
    // `fs.readFileSync(new URL(...))` requires a real Node file:// URL instance.
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, '../sophia-home-face.ts'), 'utf8')
    for (const token of ['ProviderHandle', 'CrdtRoom', 'Y.Doc', 'EditorRoomPool', 'yjs']) {
      expect(src.includes(token)).toBe(false)
    }
  })
})
