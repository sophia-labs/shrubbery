// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import '../mn-api-key-manager.js'
import type {
  MnApiKeyCreateRequest,
  MnApiKeyManager,
  MnApiKeyMetadata,
  MnApiKeyStoreLike,
  MnApiKeyStoreSnapshot,
  MnOneTimeApiKeySecret,
} from '../mn-api-key-manager.js'

const key: MnApiKeyMetadata = {
  keyId: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', displayLabel: 'Local automation', createdAtUnixSeconds: 1_800_000_000,
  expiresAtUnixSeconds: 1_900_000_000, lastUsedAtUnixSeconds: null, lastUsedOutcome: null,
  status: 'active', scopes: ['graphs.read'], graphAllowlist: [{ owner: 'user:alice', graphId: 'research' }],
  credentialVersion: 1, terminalAtUnixSeconds: null,
}

function oneTime(value: string): MnOneTimeApiKeySecret {
  return { reveal: () => value, toJSON: () => undefined }
}

function makeStore(initial: Partial<MnApiKeyStoreSnapshot> = {}) {
  let state: MnApiKeyStoreSnapshot = {
    status: 'ready', apiKeys: [key], code: null, oneTimeSecret: null, secretKeyId: null,
    secretCopied: false, replayedCreate: false, deleteResult: null, ...initial,
  }
  const listeners = new Set<() => void>()
  const emit = (next: Partial<MnApiKeyStoreSnapshot>) => {
    state = { ...state, ...next }
    listeners.forEach(listener => { listener() })
  }
  const store: MnApiKeyStoreLike & { readonly created: ReturnType<typeof vi.fn>; readonly removed: ReturnType<typeof vi.fn>; state(): MnApiKeyStoreSnapshot } = {
    snapshot: () => state,
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
    load: vi.fn(async () => undefined),
    create: vi.fn(async (request: MnApiKeyCreateRequest) => {
      void request
      emit({ apiKeys: [key], oneTimeSecret: oneTime('sph_ak1_visible_once'), secretKeyId: key.keyId })
    }),
    retryCreate: vi.fn(async () => undefined),
    remove: vi.fn(async (keyId: string) => { emit({ apiKeys: [{ ...key, keyId, status: 'deleted', terminalAtUnixSeconds: 1_800_000_001 }] }) }),
    retryDelete: vi.fn(async () => undefined),
    markSecretCopied: vi.fn(() => emit({ secretCopied: true })),
    acknowledgeSecret: vi.fn(() => emit({ oneTimeSecret: null, secretKeyId: null, secretCopied: false })),
    discardOneTimeSecret: vi.fn(() => emit({ oneTimeSecret: null, secretKeyId: null, secretCopied: false })),
    created: vi.fn(),
    removed: vi.fn(),
    state: () => state,
  }
  // Preserve easily inspectable aliases without leaking into the component API.
  Object.defineProperty(store, 'created', { value: store.create })
  Object.defineProperty(store, 'removed', { value: store.remove })
  return store
}

async function mount(store: MnApiKeyStoreLike | null): Promise<MnApiKeyManager> {
  const manager = document.createElement('mn-api-key-manager') as MnApiKeyManager
  manager.store = store
  document.body.append(manager)
  await manager.updateComplete
  await manager.updateComplete
  return manager
}

afterEach(() => { document.body.replaceChildren() })

describe('mn-api-key-manager', () => {
  it('uses selected owner-qualified workspaces from the live catalog', async () => {
    const store = makeStore()
    const manager = await mount(store)
    manager.listGraphs = async () => [{ owner: 'user:collaborator', graphId: 'research', title: 'Shared research' }]
    await manager.updateComplete
    await Promise.resolve()
    await manager.updateComplete
    const root = manager.shadowRoot!
    expect(root.querySelector('#api-key-owner-0')).toBeNull()
    const checkbox = root.querySelector<HTMLInputElement>('fieldset .ack input')!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    const label = root.querySelector<HTMLInputElement>('#api-key-label')!
    label.value = 'Notebook'
    label.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(store.created).toHaveBeenCalledWith(expect.objectContaining({ graphAllowlist: [{ owner: 'user:collaborator', graphId: 'research' }] }))
  })
  it('creates global keys explicitly and shows connection URLs for accessible workspaces', async () => {
    const store = makeStore({ apiKeys: [{ ...key, graphAccess: 'all_accessible', graphAllowlist: [], scopes: ['mcp.read'] }] })
    const manager = await mount(store)
    manager.gatewayUrl = 'https://api.sirin.sophia-labs.com'
    manager.listGraphs = async () => [{ owner: 'user:collaborator', graphId: 'research', title: 'Shared research' }]
    await manager.updateComplete
    await Promise.resolve()
    await manager.updateComplete
    const root = manager.shadowRoot!
    expect(root.querySelector<HTMLInputElement>('input[value="selected"]')?.checked).toBe(true)
    const global = root.querySelector<HTMLInputElement>('input[value="all_accessible"]')!
    global.checked = true
    global.dispatchEvent(new Event('change', { bubbles: true }))
    await manager.updateComplete
    const label = root.querySelector<HTMLInputElement>('#api-key-label')!
    label.value = 'Global agent'
    label.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    expect(store.created).toHaveBeenCalledWith(expect.objectContaining({ graphAccess: 'all_accessible', graphAllowlist: [] }))
    expect(root.querySelector<HTMLInputElement>('[aria-label="MCP URL for research"]')?.value)
      .toBe('https://api.sirin.sophia-labs.com/o/user%3Acollaborator/g/research/mcp')
    expect(root.textContent).toContain('All my workspaces (including future and shared)')
    const selected = root.querySelector<HTMLInputElement>('input[value="selected"]')!
    selected.checked = true
    selected.dispatchEvent(new Event('change', { bubbles: true }))
    await manager.updateComplete
    root.querySelector('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    expect(store.created).toHaveBeenCalledTimes(1) // Empty selected mode cannot silently become global.
  })

  it('offers separate HTTP and MCP permissions with exact workspace controls', async () => {
    const manager = await mount(makeStore())
    const scopes = [...manager.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .map(input => input.parentElement?.textContent?.trim())
    expect(scopes).toEqual(expect.arrayContaining(['HTTP Read', 'HTTP Write', 'MCP Read', 'MCP Write']))
    expect(manager.shadowRoot!.querySelectorAll('input[value="mcp.read"],input[value="graphs.sync"]').length).toBe(0)
    expect(manager.shadowRoot!.querySelector('#api-key-owner-0')).not.toBeNull()
    expect(manager.shadowRoot!.querySelector('#api-key-graph-0')).not.toBeNull()
    expect(manager.shadowRoot!.textContent).toContain('mnemo_')
  })

  it('MCP write implies read and connection URLs retain the canonical owner without embedding a secret', async () => {
    const manager = await mount(makeStore({ apiKeys: [{ ...key, scopes: ['mcp.read'], graphAllowlist: [{ owner: 'user:collaborator', graphId: 'research' }] }] }))
    manager.gatewayUrl = 'https://api.sirin.sophia-labs.com/o/user:alice/g/home'
    await manager.updateComplete
    const root = manager.shadowRoot!
    const checkboxes = [...root.querySelectorAll<HTMLInputElement>('.scope-options input')]
    checkboxes[3]!.checked = true
    checkboxes[3]!.dispatchEvent(new Event('change', { bubbles: true }))
    await manager.updateComplete
    expect(checkboxes[2]!.checked).toBe(true)
    checkboxes[2]!.checked = false
    checkboxes[2]!.dispatchEvent(new Event('change', { bubbles: true }))
    await manager.updateComplete
    expect(checkboxes[3]!.checked).toBe(false)
    expect(root.querySelector<HTMLInputElement>('[aria-label="MCP URL for research"]')?.value)
      .toBe('https://api.sirin.sophia-labs.com/o/user%3Acollaborator/g/research/mcp')
    expect(root.textContent).toContain('Authorization: Bearer <your API key>')
    expect(root.textContent).not.toContain('sph_ak1_')
  })

  it('creates an exact scoped request and retains the secret only until explicit acknowledgement', async () => {
    const store = makeStore()
    const manager = await mount(store)
    const root = manager.shadowRoot!
    const label = root.querySelector<HTMLInputElement>('#api-key-label')!
    const expiry = root.querySelector<HTMLInputElement>('#api-key-expiry')!
    const owner = root.querySelector<HTMLInputElement>('#api-key-owner-0')!
    const graph = root.querySelector<HTMLInputElement>('#api-key-graph-0')!
    label.value = ' CI deploy '
    label.dispatchEvent(new Event('input', { bubbles: true }))
    expiry.value = '2030-01-01T12:00'
    expiry.dispatchEvent(new Event('input', { bubbles: true }))
    owner.value = 'user:alice'
    owner.dispatchEvent(new Event('input', { bubbles: true }))
    graph.value = 'research'
    graph.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('form')!.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(store.created).toHaveBeenCalledWith(expect.objectContaining({
      displayLabel: 'CI deploy', scopes: ['graphs.read'], graphAllowlist: [{ owner: 'user:alice', graphId: 'research' }],
    }))
    await manager.updateComplete
    expect(root.querySelector<HTMLInputElement>('[aria-label="One-time API key secret"]')?.value).toBe('sph_ak1_visible_once')
    expect(JSON.stringify(store.state())).not.toContain('sph_ak1_visible_once')
    const acknowledgement = root.querySelector<HTMLInputElement>('.ack input')!
    acknowledgement.checked = true
    acknowledgement.dispatchEvent(new Event('change', { bubbles: true }))
    await manager.updateComplete
    ;[...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'I’ve saved it')!.click()
    expect(store.acknowledgeSecret).toHaveBeenCalledTimes(1)
  })

  it('requires a second destructive action before revocation', async () => {
    const store = makeStore()
    const manager = await mount(store)
    const revoke = [...manager.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === 'Revoke key…')!
    revoke.click()
    await manager.updateComplete
    expect(store.removed).not.toHaveBeenCalled()
    expect(manager.shadowRoot!.querySelector('[role="alertdialog"]')).not.toBeNull()
    ;[...manager.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === 'Revoke key')!.click()
    await Promise.resolve()
    expect(store.removed).toHaveBeenCalledWith(key.keyId)
  })

  it('drops the secret only at lifecycle boundaries, including pagehide and disconnect', async () => {
    const store = makeStore({ oneTimeSecret: oneTime('sph_ak1_lifecycle_only'), secretKeyId: key.keyId })
    const manager = await mount(store)
    expect(manager.shadowRoot!.querySelector('[aria-label="One-time API key secret"]')).not.toBeNull()
    await manager.updateComplete
    expect(store.discardOneTimeSecret).not.toHaveBeenCalled()
    globalThis.dispatchEvent(new Event('pagehide'))
    expect(store.discardOneTimeSecret).toHaveBeenCalledTimes(1)
    await manager.updateComplete
    expect(manager.shadowRoot!.querySelector('[aria-label="One-time API key secret"]')).toBeNull()

    const second = makeStore({ oneTimeSecret: oneTime('sph_ak1_disconnect_only'), secretKeyId: key.keyId })
    manager.store = second
    await manager.updateComplete
    manager.remove()
    expect(second.discardOneTimeSecret).toHaveBeenCalledTimes(1)
  })

  it('focuses Cancel, traps Tab, and restores focus after Escape closes revocation', async () => {
    const store = makeStore()
    const manager = await mount(store)
    const root = manager.shadowRoot!
    const revoke = root.querySelector<HTMLButtonElement>('[data-revoke-key-id]')!
    revoke.focus()
    revoke.click()
    await manager.updateComplete
    await Promise.resolve()
    const dialog = root.querySelector<HTMLElement>('[role="alertdialog"]')!
    const cancel = dialog.querySelector<HTMLButtonElement>('[data-confirm-cancel]')!
    const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.trim() === 'Revoke key')!
    expect(root.activeElement).toBe(cancel)
    cancel.focus()
    const shifted = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    cancel.dispatchEvent(shifted)
    expect(shifted.defaultPrevented).toBe(true)
    expect(root.activeElement).toBe(confirm)
    const tabbed = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    confirm.dispatchEvent(tabbed)
    expect(tabbed.defaultPrevented).toBe(true)
    expect(root.activeElement).toBe(cancel)
    const escaped = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    cancel.dispatchEvent(escaped)
    await manager.updateComplete
    await Promise.resolve()
    expect(root.querySelector('[role="alertdialog"]')).toBeNull()
    expect(root.activeElement).toBe(root.querySelector('[data-revoke-key-id]'))
  })
})
