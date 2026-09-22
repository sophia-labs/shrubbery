import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'lit'
import '../../../components/src/mn-editor-toolbar.js'
import { mountEditorHost } from '../mount.js'
import {
  NULL_EDITOR_HOST_STATE,
  type EditorHostBinding,
  type EditorHostState,
} from '../editor-host-binding.js'
import type { ShEditorHost } from '../editor-host.js'
import { InProcessCrdtBackend } from './in-process-crdt-backend.js'

interface SettableBinding extends EditorHostBinding {
  set(next: EditorHostState): void
}

function makeBinding(initial: EditorHostState = NULL_EDITOR_HOST_STATE): SettableBinding {
  let value = initial
  const subs = new Set<(v: EditorHostState) => void>()
  return {
    get: () => value,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    set(next) {
      value = next
      for (const cb of subs) cb(value)
    },
  }
}

function connectedContainer(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}

const hostEl = (c: HTMLElement) => c.querySelector('#mn-editor-host') as ShEditorHost | null

async function settle(h: ShEditorHost): Promise<void> {
  await h.updateComplete
  await Promise.resolve()
  await Promise.resolve()
  await h.updateComplete
}

let backends: InProcessCrdtBackend[] = []

afterEach(() => {
  for (const be of backends) be.destroyAll()
  backends = []
  document.body.replaceChildren()
})

function backend(): InProcessCrdtBackend {
  const be = new InProcessCrdtBackend()
  backends.push(be)
  return be
}

async function mountLiveHost(): Promise<ShEditorHost> {
  const provider = backend().open({ kind: 'doc', graphId: 'g-search', docId: 'd-search' })
  const binding = makeBinding({
    centerMode: 'document',
    graphId: 'g-search',
    documentId: 'd-search',
    status: 'ready',
    error: null,
    provider,
  })
  const container = connectedContainer()
  render(mountEditorHost(binding), container)
  const h = hostEl(container)!
  await settle(h)
  expect(h.liveEditor).not.toBeNull()
  return h
}

function setEditorContent(h: ShEditorHost, html: string): void {
  const real = h as unknown as {
    _editor: { commands: { setContent(html: string): boolean } }
  }
  expect(real._editor.commands.setContent(html)).toBe(true)
}

async function toolbarRoot(h: ShEditorHost): Promise<ShadowRoot> {
  const toolbar = h.shadowRoot!.querySelector('mn-editor-toolbar') as
    | (HTMLElement & { updateComplete?: Promise<unknown> })
    | null
  expect(toolbar).not.toBeNull()
  await toolbar!.updateComplete
  return toolbar!.shadowRoot!
}

async function shadowButton(control: Element | null): Promise<HTMLButtonElement> {
  expect(control).not.toBeNull()
  const el = control as HTMLElement & { updateComplete?: Promise<unknown> }
  await el.updateComplete
  const button = el.shadowRoot?.querySelector('button') as HTMLButtonElement | null
  expect(button).not.toBeNull()
  return button!
}

async function clickToolbarControl(h: ShEditorHost, selector: string): Promise<void> {
  const button = await shadowButton((await toolbarRoot(h)).querySelector(selector))
  button.click()
  await h.updateComplete
}

async function openFindWithShortcut(h: ShEditorHost): Promise<void> {
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  })
  expect(document.dispatchEvent(event)).toBe(false)
  await h.updateComplete
  await toolbarRoot(h)
}

async function inputValue(h: ShEditorHost, selector: string, value: string): Promise<HTMLInputElement> {
  const input = (await toolbarRoot(h)).querySelector(selector) as HTMLInputElement | null
  expect(input).not.toBeNull()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  await h.updateComplete
  return input!
}

describe('sh-editor-host find/replace surface', () => {
  it('opens with Mod-F and drives the real kernel Search decorations', async () => {
    const h = await mountLiveHost()
    setEditorContent(h, '<p>alpha beta alpha gamma</p>')
    const mount = h.shadowRoot!.querySelector('.editor-mount')

    await openFindWithShortcut(h)

    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
    expect((await toolbarRoot(h)).querySelector('[data-search-input]')).not.toBeNull()
    await inputValue(h, '[data-search-input]', 'alpha')

    expect((await toolbarRoot(h)).querySelector('[data-search-count]')?.textContent?.trim()).toBe(
      '1 / 2',
    )
    expect(h.shadowRoot!.querySelectorAll('.search-match')).toHaveLength(2)
    expect(h.shadowRoot!.querySelectorAll('.search-match-current')).toHaveLength(1)

    await clickToolbarControl(h, '[data-search-next]')
    expect((await toolbarRoot(h)).querySelector('[data-search-count]')?.textContent?.trim()).toBe(
      '2 / 2',
    )

    await clickToolbarControl(h, '[data-search-close]')
    expect(h.shadowRoot!.querySelector('.editor-mount')).toBe(mount)
    expect((await toolbarRoot(h)).querySelector('.find-bar')).toBeNull()
    expect((await toolbarRoot(h)).querySelector('[data-search-input]')).toBeNull()
    expect(h.shadowRoot!.querySelectorAll('.search-match')).toHaveLength(0)
  })

  it('replaces current and all matches through the live editor commands', async () => {
    const h = await mountLiveHost()
    setEditorContent(h, '<p>alpha one alpha two alpha</p>')

    await clickToolbarControl(h, '[data-search-open]')
    await inputValue(h, '[data-search-input]', 'alpha')
    await inputValue(h, '[data-replace-input]', 'beta')

    await clickToolbarControl(h, '[data-replace-current]')
    expect(h.liveEditor!.getText()).toBe('beta one alpha two alpha')
    expect((await toolbarRoot(h)).querySelector('[data-search-count]')?.textContent?.trim()).toBe(
      '1 / 2',
    )

    await inputValue(h, '[data-replace-input]', 'gamma')
    await clickToolbarControl(h, '[data-replace-all]')

    expect(h.liveEditor!.getText()).toBe('beta one gamma two gamma')
    expect((await toolbarRoot(h)).querySelector('[data-search-count]')?.textContent?.trim()).toBe(
      '0 / 0',
    )
  })
})
