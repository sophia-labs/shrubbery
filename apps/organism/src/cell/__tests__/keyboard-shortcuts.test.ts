import { CommandRegistryImpl, type CommandContext } from '@shrubbery/nucleus'
import { afterEach, describe, expect, it } from 'vitest'
import {
  handleLandmarkCycleShortcut,
  handleRegistryDocumentShortcut,
} from '../keyboard-shortcuts.js'

const ctx: CommandContext = {
  selection: { kind: 'document', graphId: 'graph-a', documentId: 'doc-a', title: 'Document A' },
  graphId: 'graph-a',
  documentId: 'doc-a',
  rightPanelMode: 'chat',
  posture: 'application',
}

function dispatchKey(
  target: HTMLElement,
  init: KeyboardEventInit,
  handler: (event: KeyboardEvent) => void,
): KeyboardEvent {
  const listener = (event: Event) => handler(event as KeyboardEvent)
  document.addEventListener('keydown', listener, { capture: true, once: true })
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('registry document keyboard parity', () => {
  it('executes document.new from Mod+Alt+N using e.code despite an Option-composed key', () => {
    const registry = new CommandRegistryImpl()
    const calls: string[] = []
    registry.register({
      id: 'document.new', label: 'New Document', category: 'Document', shortcut: 'Mod+Alt+N',
      surfaces: ['palette', 'shortcut'], run: () => { calls.push('new') },
    })
    const target = document.body
    const event = dispatchKey(target, {
      key: '˜', code: 'KeyN', metaKey: true, altKey: true,
    }, key => {
      expect(handleRegistryDocumentShortcut(key, registry, ctx)).toBe('document.new')
    })

    expect(event.defaultPrevented).toBe(true)
    expect(calls).toEqual(['new'])
  })

  it('executes document.rename from unmodified F2 through the registry', () => {
    const registry = new CommandRegistryImpl()
    const calls: string[] = []
    registry.register({
      id: 'document.rename', label: 'Rename Document', category: 'Document', shortcut: 'F2',
      surfaces: ['context', 'shortcut'], appliesTo: selection => selection?.kind === 'document',
      run: commandCtx => { calls.push(String(commandCtx.documentId)) },
    })
    const event = dispatchKey(document.body, { key: 'F2', code: 'F2' }, key => {
      expect(handleRegistryDocumentShortcut(key, registry, ctx)).toBe('document.rename')
    })

    expect(event.defaultPrevented).toBe(true)
    expect(calls).toEqual(['doc-a'])
  })

  it('does not consume unavailable, repeated, text-entry, contenteditable, or modal shortcuts', () => {
    const registry = new CommandRegistryImpl()
    const calls: string[] = []
    registry.register({
      id: 'document.rename', label: 'Rename Document', category: 'Document', shortcut: 'F2',
      surfaces: ['shortcut'], when: () => false, run: () => { calls.push('rename') },
    })

    const targets = [
      document.body,
      document.body.appendChild(document.createElement('input')),
      document.body.appendChild(Object.assign(document.createElement('div'), { contentEditable: 'true' })),
      document.body.appendChild(document.createElement('section')),
    ]
    targets[3].setAttribute('role', 'dialog')
    for (const [index, target] of targets.entries()) {
      const event = dispatchKey(target, { key: 'F2', code: 'F2', repeat: index === 0 }, key => {
        expect(handleRegistryDocumentShortcut(key, registry, ctx)).toBeNull()
      })
      expect(event.defaultPrevented).toBe(false)
    }
    expect(calls).toEqual([])
  })

  it('does not let a strong create chord stack another prompt over a text input', () => {
    const registry = new CommandRegistryImpl()
    const calls: string[] = []
    registry.register({
      id: 'document.new', label: 'New Document', category: 'Document', shortcut: 'Mod+Alt+N',
      surfaces: ['shortcut'], run: () => { calls.push('new') },
    })
    const input = document.body.appendChild(document.createElement('input'))
    const event = dispatchKey(input, { key: '˜', code: 'KeyN', metaKey: true, altKey: true }, key => {
      expect(handleRegistryDocumentShortcut(key, registry, ctx)).toBeNull()
    })
    expect(event.defaultPrevented).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('F6 landmark cycling', () => {
  it('cycles navigation → main → complementary and reverses with Shift+F6', () => {
    const nav = document.body.appendChild(document.createElement('nav'))
    nav.setAttribute('role', 'navigation')
    const navButton = nav.appendChild(document.createElement('button'))
    const main = document.body.appendChild(document.createElement('main'))
    main.setAttribute('role', 'main')
    const aside = document.body.appendChild(document.createElement('aside'))
    aside.setAttribute('role', 'complementary')
    const nestedAside = aside.appendChild(document.createElement('aside'))
    nestedAside.setAttribute('role', 'complementary')
    const asideButton = nestedAside.appendChild(document.createElement('button'))
    const options = { isVisible: () => true }

    let event = dispatchKey(document.body, { key: 'F6', code: 'F6' }, key => {
      expect(handleLandmarkCycleShortcut(key, document.body, document, options)).toBe(nav)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(navButton)

    event = dispatchKey(navButton, { key: 'F6', code: 'F6' }, key => {
      expect(handleLandmarkCycleShortcut(key, document.body, document, options)).toBe(main)
    })
    expect(document.activeElement).toBe(main)
    expect(main.getAttribute('tabindex')).toBe('-1')

    dispatchKey(main, { key: 'F6', code: 'F6' }, key => {
      expect(handleLandmarkCycleShortcut(key, document.body, document, options)).toBe(aside)
    })
    expect(document.activeElement).toBe(asideButton)
    expect(main.hasAttribute('tabindex')).toBe(false)

    dispatchKey(asideButton, { key: 'F6', code: 'F6', shiftKey: true }, key => {
      expect(handleLandmarkCycleShortcut(key, document.body, document, options)).toBe(main)
    })
    expect(document.activeElement).toBe(main)
  })

  it('does not escape an active modal or consume modified/repeated F6', () => {
    const main = document.body.appendChild(document.createElement('main'))
    main.setAttribute('role', 'main')
    const dialog = document.body.appendChild(document.createElement('section'))
    dialog.setAttribute('role', 'dialog')
    const input = dialog.appendChild(document.createElement('input'))
    const cases: KeyboardEventInit[] = [
      { key: 'F6', code: 'F6' },
      { key: 'F6', code: 'F6', metaKey: true },
      { key: 'F6', code: 'F6', altKey: true },
      { key: 'F6', code: 'F6', repeat: true },
    ]
    for (const init of cases) {
      const target = init.metaKey || init.altKey || init.repeat ? document.body : input
      const event = dispatchKey(target, init, key => {
        expect(handleLandmarkCycleShortcut(key, document.body, document, { isVisible: () => true })).toBeNull()
      })
      expect(event.defaultPrevented).toBe(false)
    }
  })
})
