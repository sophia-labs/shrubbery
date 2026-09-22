/**
 * presence-projection.test.ts — the hoisted aggregation/mutation logic
 * (`presence-projection.ts`), proven against a REAL `y-protocols/awareness`
 * `Awareness` bound to a REAL `Y.Doc` (no mocks — mirrors `sh-editor-host-
 * collab-body.test.ts`'s own precedent for exercising a real Awareness
 * in-process). These are the exact aggregation branches
 * `apps/organism/src/cell/chrome-controller.ts`'s `projectPresence` proves in
 * production; this suite proves the hoisted copy carries the same behavior.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import {
  canEditSelfPresence,
  projectPresence,
  updateLocalPresenceProfile,
  type PresenceAwarenessLike,
} from '../presence-projection.js'

function richLocalState(overrides: Partial<{
  name: string
  color: string
  type: 'human' | 'agent'
  humanId: string
  deviceId: string
  clientId: string
  connectionEpoch: number
  publishedAt: number
}> = {}): Record<string, unknown> {
  const {
    name = 'Vera',
    color = '#2563eb',
    type = 'human',
    humanId = 'vera',
    deviceId = 'device-a',
    clientId = 'tab-a',
    connectionEpoch = 1,
    publishedAt = 1000,
  } = overrides
  return {
    // Real production state keeps `user.userId` and `presence.humanId` in
    // sync (`crdt-presence.ts`'s `PresenceIdentityController.next()` sets
    // `presence.humanId: user.userId` from the same value) — `user.userId`
    // is what self-update reads; `presence.humanId` is what aggregation reads.
    user: { name, color, type, userId: humanId },
    presence: { humanId, deviceId, clientId, connectionEpoch, publishedAt },
  }
}

const docs: Y.Doc[] = []
const awarenesses: Awareness[] = []

function realAwareness(): Awareness {
  const doc = new Y.Doc()
  docs.push(doc)
  const awareness = new Awareness(doc)
  awarenesses.push(awareness)
  return awareness
}

afterEach(() => {
  for (const awareness of awarenesses.splice(0)) awareness.destroy()
  for (const doc of docs.splice(0)) doc.destroy()
})

describe('projectPresence', () => {
  it('returns nothing for a non-awareness value and for an empty real awareness', () => {
    expect(projectPresence(null)).toEqual([])
    expect(projectPresence({})).toEqual([])
    const awareness = realAwareness()
    expect(projectPresence(awareness)).toEqual([])
  })

  it('projects a single real local client with rich presence metadata as isSelf', () => {
    const awareness = realAwareness()
    awareness.setLocalState(richLocalState())
    const people = projectPresence(awareness)
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({
      id: 'human:vera',
      name: 'Vera',
      color: '#2563eb',
      humanId: 'vera',
      isSelf: true,
      sessionCount: 1,
      type: 'human',
    })
    expect(people[0]!.sessions).toEqual([
      { awarenessClientId: String(awareness.clientID), clientId: 'tab-a', deviceId: 'device-a', connectionEpoch: 1, hasCursor: false, isLocal: true },
    ])
  })

  it('groups two sessions of the SAME human (two tabs) under one logical person', () => {
    const awareness = realAwareness()
    // Simulate a second browser tab of the SAME human: a genuinely SEPARATE
    // `Y.Doc` (a fresh, distinct random `clientID`, exactly like two real
    // tabs each own their own Y.Doc) with its own `Awareness`, merged into
    // the first via `applyAwarenessUpdate` — the real cross-tab sync
    // mechanism a network hop performs in production.
    const second = realAwareness()
    awareness.setLocalState(richLocalState({ clientId: 'tab-a', connectionEpoch: 1, publishedAt: 1000 }))
    second.setLocalState(richLocalState({ clientId: 'tab-b', connectionEpoch: 1, publishedAt: 2000 }))

    // Merge second's state into awareness's own states map the way a real
    // network hop would (encode/apply), so `awareness.getStates()` sees both.
    const update = encodeAwarenessUpdate(second, [second.clientID])
    applyAwarenessUpdate(awareness, update, 'remote')

    const people = projectPresence(awareness)
    expect(people).toHaveLength(1)
    const vera = people[0]!
    expect(vera.sessionCount).toBe(2)
    expect(vera.isSelf).toBe(true) // the local awareness's own client is in the group
    expect(vera.clientIds).toEqual(['tab-a', 'tab-b'])
  })

  it('falls back to a legacy per-awareness-client identity when presence metadata is absent or invalid', () => {
    const awareness = realAwareness()
    awareness.setLocalState({ user: { name: 'Legacy', color: '#16a34a' } })
    const people = projectPresence(awareness)
    expect(people).toHaveLength(1)
    expect(people[0]!.humanId).toBeNull()
    expect(people[0]!.id).toBe(String(awareness.clientID))
  })

  it('ignores a state with no user, or an invalid color', () => {
    const awareness = realAwareness()
    awareness.setLocalState({ presence: { humanId: 'x' } })
    expect(projectPresence(awareness)).toEqual([])
    awareness.setLocalState({ user: { name: 'X', color: 'not-a-color' } })
    expect(projectPresence(awareness)).toEqual([])
  })
})

describe('canEditSelfPresence', () => {
  it('is true for a real awareness with local state read+write, false otherwise', () => {
    const awareness = realAwareness()
    expect(canEditSelfPresence(awareness)).toBe(true)
    expect(canEditSelfPresence(null)).toBe(false)
    const readOnly: PresenceAwarenessLike = {
      getStates: () => new Map(),
      on: () => {},
      off: () => {},
    }
    expect(canEditSelfPresence(readOnly)).toBe(false)
  })
})

describe('updateLocalPresenceProfile', () => {
  it('renames and recolors a real self awareness state, preserving identity/type', () => {
    const awareness = realAwareness()
    awareness.setLocalState(richLocalState({ name: 'Vera', color: '#2563eb' }))
    const result = updateLocalPresenceProfile(awareness, { name: ' Vera Prime ', color: '#16a34a' })
    expect(result).toEqual({ name: 'Vera Prime', color: '#16a34a' })
    const state = awareness.getLocalState() as { user: { name: string; color: string; type: string; userId: string } }
    expect(state.user).toMatchObject({ name: 'Vera Prime', color: '#16a34a', type: 'human', userId: 'vera' })
  })

  it('refuses to edit an agent identity, and refuses an invalid color', () => {
    const awareness = realAwareness()
    awareness.setLocalState(richLocalState({ type: 'agent' }))
    expect(updateLocalPresenceProfile(awareness, { name: 'Nope' })).toBeNull()

    const human = realAwareness()
    human.setLocalState(richLocalState())
    expect(updateLocalPresenceProfile(human, { color: 'not-a-color' })).toBeNull()
    expect((human.getLocalState() as { user: { color: string } }).user.color).toBe('#2563eb')
  })

  it('returns null when there is no local state at all', () => {
    const awareness = realAwareness()
    expect(updateLocalPresenceProfile(awareness, { name: 'X' })).toBeNull()
  })

  it('persists the profile under the SAME key format crdt-presence.ts reads back on reconnect (wave1 review r1 WRONG fix)', () => {
    // A real, in-memory-backed Storage-shaped object — not a spy — proving
    // the actual write, not just that a function was called.
    const backing = new Map<string, string>()
    const storage = { getItem: (key: string) => backing.get(key) ?? null, setItem: (key: string, value: string) => { backing.set(key, value) } }
    const awareness = realAwareness()
    awareness.setLocalState(richLocalState({ name: 'Vera', color: '#2563eb', humanId: 'vera-1' }))
    const result = updateLocalPresenceProfile(awareness, { name: 'Vera Prime', color: '#16a34a' }, storage)
    expect(result).toEqual({ name: 'Vera Prime', color: '#16a34a' })
    // `crdt-presence.ts`'s own (private) `profileKey`: `garden.presence.profile.v1:${encodeURIComponent(humanId)}`.
    expect(backing.get('garden.presence.profile.v1:vera-1')).toBe(
      JSON.stringify({ name: 'Vera Prime', color: '#16a34a' }),
    )
  })

  it('a null storage explicitly opts out of persistence (tests / no-storage callers), same as the default when window is absent', () => {
    const awareness = realAwareness()
    awareness.setLocalState(richLocalState({ name: 'Vera', color: '#2563eb' }))
    const result = updateLocalPresenceProfile(awareness, { name: 'Vera Prime' }, null)
    expect(result).toEqual({ name: 'Vera Prime', color: '#2563eb' })
  })

  it('degrades gracefully — never throws — when window.localStorage access ITSELF throws (storage-blocked browser), using the real default accessor', () => {
    // Some browser storage policies make *accessing* window.localStorage throw,
    // not just setItem. Mirrors crdt-presence.ts's own browserStorage try/catch:
    // the default accessor must swallow that throw so awareness stays live.
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage access blocked by browser policy') },
    })
    try {
      const awareness = realAwareness()
      awareness.setLocalState(richLocalState({ name: 'Vera', color: '#2563eb' }))
      // No explicit storage arg → the default accessor runs and must not throw.
      const result = updateLocalPresenceProfile(awareness, { name: 'Vera Prime' })
      expect(result).toEqual({ name: 'Vera Prime', color: '#2563eb' })
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
      else Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'localStorage')
    }
  })
})
