import { describe, expect, it } from 'vitest'
import {
  clearLocalPresence,
  installLocalPresence,
  localPresenceUser,
  PresenceIdentityController,
  presenceRoomLocation,
  updateLocalPresenceProfile,
  type PresenceStorage,
} from '../crdt-presence.js'

class MemoryStorage implements PresenceStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('CRDT local presence', () => {
  it('maps a stable user identity to a deterministic Garden cursor color', () => {
    expect(localPresenceUser('vera')).toEqual(localPresenceUser('vera'))
    expect(localPresenceUser('vera').name).toBe('vera')
    expect(localPresenceUser('')).toMatchObject({ name: 'You' })
  })

  it('publishes the user through the real awareness field contract', () => {
    const fields = new Map<string, unknown>()
    const user = installLocalPresence({
      setLocalStateField(field, value) {
        fields.set(field, value)
      },
    }, 'agent-7')

    expect(fields.get('user')).toEqual(user)
    expect(user.name).toBe('agent-7')
    expect(user.color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('distinguishes stable human, device, tab, room, and connection epoch', () => {
    const local = new MemoryStorage()
    const session = new MemoryStorage()
    const identity = new PresenceIdentityController({
      deviceStorage: local,
      clientStorage: session,
      createId: (() => {
        const ids = ['device-a', 'tab-a']
        return () => ids.shift() ?? 'unexpected'
      })(),
      now: () => 1_725_000_000_000,
    })
    const room = presenceRoomLocation({ graphId: 'garden', kind: 'doc', docId: 'welcome' })

    const first = identity.next('vera', room)
    const reconnect = identity.next('vera', room)
    expect(first.presence).toEqual({
      schemaVersion: 1,
      humanId: 'vera',
      deviceId: 'device-a',
      clientId: 'tab-a',
      connectionEpoch: 1,
      room: { graphId: 'garden', kind: 'document', documentId: 'welcome' },
      publishedAt: 1_725_000_000_000,
    })
    expect(reconnect.presence.connectionEpoch).toBe(2)

    // A reload gets the same browser/tab IDs and advances the persisted epoch.
    const afterReload = new PresenceIdentityController({
      deviceStorage: local,
      clientStorage: session,
      createId: () => 'must-not-be-used',
      now: () => 1_725_000_000_001,
    }).next('vera', room)
    expect(afterReload.presence).toMatchObject({
      deviceId: 'device-a',
      clientId: 'tab-a',
      connectionEpoch: 3,
    })
  })

  it('publishes rich lifecycle state and clears awareness cooperatively', () => {
    const fields = new Map<string, unknown>()
    let cleared: Record<string, unknown> | null | undefined
    const awareness = {
      setLocalStateField(field: string, value: unknown) { fields.set(field, value) },
      setLocalState(state: Record<string, unknown> | null) { cleared = state },
    }
    const state = new PresenceIdentityController({
      deviceId: 'device-a',
      clientId: 'tab-a',
      clientStorage: null,
      now: () => 123,
    }).next('agent-7', { graphId: 'graph', kind: 'workspace' })

    installLocalPresence(awareness, state)
    expect(fields.get('user')).toEqual(state.user)
    expect(fields.get('presence')).toEqual(state.presence)
    clearLocalPresence(awareness)
    expect(cleared).toBeNull()
  })

  it('persists real self name/color changes without mutating stable identity', () => {
    const local = new MemoryStorage()
    const session = new MemoryStorage()
    const identity = new PresenceIdentityController({
      deviceId: 'device-a',
      clientId: 'tab-a',
      deviceStorage: local,
      clientStorage: session,
      now: () => 100,
    })
    let current = identity.next(
      'vera',
      { graphId: 'graph', kind: 'document', documentId: 'doc' },
    ) as unknown as Record<string, unknown>
    const awareness = {
      getLocalState: () => current,
      setLocalState: (state: Record<string, unknown> | null) => { current = state ?? {} },
      setLocalStateField: (field: string, value: unknown) => { current = { ...current, [field]: value } },
    }
    const updated = updateLocalPresenceProfile(
      awareness,
      { name: 'Vera Prime', color: '#16a34a' },
      { storage: local, now: () => 200 },
    )
    expect(updated).toMatchObject({
      userId: 'vera', name: 'Vera Prime', color: '#16a34a', type: 'human',
      clientId: 'tab-a', deviceId: 'device-a',
    })
    expect(current.presence).toMatchObject({
      humanId: 'vera', clientId: 'tab-a', connectionEpoch: 1, publishedAt: 200,
    })

    const reconnect = new PresenceIdentityController({
      deviceId: 'device-a',
      clientId: 'tab-a',
      deviceStorage: local,
      clientStorage: session,
      now: () => 300,
    }).next('vera', { graphId: 'graph', kind: 'document', documentId: 'doc' })
    expect(reconnect.user).toMatchObject({ name: 'Vera Prime', color: '#16a34a' })
    expect(reconnect.presence).toMatchObject({ humanId: 'vera', clientId: 'tab-a' })
  })

  it('regenerates a copied sessionStorage client ID for a real Duplicate-Tab shape', () => {
    const local = new MemoryStorage()
    const originalSession = new MemoryStorage()
    const ids = ['device-a', 'tab-a']
    const original = new PresenceIdentityController({
      deviceStorage: local,
      clientStorage: originalSession,
      clientLeaseStorage: local,
      clientLeaseOwnerId: 'page-original',
      navigationType: 'navigate',
      createId: () => ids.shift() ?? 'unexpected-original-id',
      now: () => 100,
    })
    original.next('vera', { graphId: 'graph', kind: 'document', documentId: 'doc' })

    // window.open / Duplicate Tab starts with a copy, not a shared reference.
    const duplicateSession = new MemoryStorage()
    for (const [key, value] of originalSession.values) duplicateSession.setItem(key, value)
    const duplicate = new PresenceIdentityController({
      deviceStorage: local,
      clientStorage: duplicateSession,
      clientLeaseStorage: local,
      clientLeaseOwnerId: 'page-duplicate',
      navigationType: 'navigate',
      createId: () => 'tab-b',
      now: () => 101,
    })
    expect(original.clientId).toBe('tab-a')
    expect(duplicate.clientId).toBe('tab-b')
    expect(duplicate.next('vera', { graphId: 'graph', kind: 'document', documentId: 'doc' }).presence)
      .toMatchObject({ clientId: 'tab-b', connectionEpoch: 1 })

    // A reload may see the prior page's lease briefly; it keeps the tab ID.
    const reload = new PresenceIdentityController({
      deviceStorage: local,
      clientStorage: duplicateSession,
      clientLeaseStorage: local,
      clientLeaseOwnerId: 'page-duplicate-reload',
      navigationType: 'reload',
      createId: () => 'must-not-regenerate',
      now: () => 102,
    })
    expect(reload.clientId).toBe('tab-b')
  })
})
