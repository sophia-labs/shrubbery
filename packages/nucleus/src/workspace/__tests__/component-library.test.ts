/**
 * iteration 1a — component-library.ts seam test.
 *
 * The manifest fold: interpreter's inline PERSISTENCE_BY_TAG and the standalone
 * component-library/manifest.ts stub are now ONE table — COMPONENT_LIBRARY in
 * component-library.ts. This pins:
 *   - the new seams: COMPONENT_LIBRARY shape, persistenceOf, isRegisteredComponent;
 *   - that interpreter.persistenceOf is the SAME function (no drift between the
 *     two tables that used to be maintained by hand);
 *   - registered ≠ stamp: an unregistered tag also resolves to 'stamp', so
 *     isRegisteredComponent answers a strictly different question;
 *   - the deprecated manifest shim still resolves and agrees with the library.
 *
 * Pure: no DOM, no stores, no custom-element registration.
 */

import { describe, it, expect } from 'vitest'
import {
  COMPONENT_LIBRARY,
  isRegisteredComponent,
  persistenceOf,
  type Persistence,
} from '../component-library.js'
import { persistenceOf as interpreterPersistenceOf } from '../interpreter.js'

describe('component-library — COMPONENT_LIBRARY table', () => {
  it('lists the engine-manifested panel components, keyed by tag', () => {
    expect(Object.keys(COMPONENT_LIBRARY).sort()).toEqual([
      'mn-document-editor',
      'mn-graph-panel',
      'mn-vtuber',
    ])
  })

  it('each entry is { tag, persistence } with tag === key', () => {
    for (const [key, entry] of Object.entries(COMPONENT_LIBRARY)) {
      expect(entry.tag).toBe(key)
      expect(['stamp', 'persistent-relocatable', 'persistent-non-relocatable']).toContain(entry.persistence)
    }
  })

  it('mn-document-editor is Class B; mn-graph-panel and mn-vtuber are Class C', () => {
    expect(COMPONENT_LIBRARY['mn-document-editor'].persistence).toBe('persistent-relocatable')
    expect(COMPONENT_LIBRARY['mn-graph-panel'].persistence).toBe('persistent-non-relocatable')
    expect(COMPONENT_LIBRARY['mn-vtuber'].persistence).toBe('persistent-non-relocatable')
  })

  it('the table is frozen (agent-unwritable)', () => {
    expect(Object.isFrozen(COMPONENT_LIBRARY)).toBe(true)
  })
})

describe('component-library — persistenceOf', () => {
  it('resolves registered tags to their class', () => {
    expect(persistenceOf('mn-document-editor')).toBe('persistent-relocatable')
    expect(persistenceOf('mn-graph-panel')).toBe('persistent-non-relocatable')
    expect(persistenceOf('mn-vtuber')).toBe('persistent-non-relocatable')
  })

  it('defaults unregistered tags to Class A (stamp)', () => {
    expect(persistenceOf('mn-chat-panel')).toBe('stamp')
    expect(persistenceOf('anything-unknown')).toBe('stamp')
    expect(persistenceOf('')).toBe('stamp')
  })

  it('returns only valid Persistence literals', () => {
    const valid: Persistence[] = ['stamp', 'persistent-relocatable', 'persistent-non-relocatable']
    for (const tag of ['mn-document-editor', 'mn-graph-panel', 'mn-vtuber', 'unknown']) {
      expect(valid).toContain(persistenceOf(tag))
    }
  })
})

describe('component-library — isRegisteredComponent (the new seam)', () => {
  it('is true only for explicitly-listed tags', () => {
    expect(isRegisteredComponent('mn-document-editor')).toBe(true)
    expect(isRegisteredComponent('mn-graph-panel')).toBe(true)
    expect(isRegisteredComponent('mn-vtuber')).toBe(true)
  })

  it('is false for unregistered tags — even though they resolve to stamp', () => {
    expect(isRegisteredComponent('mn-chat-panel')).toBe(false)
    expect(persistenceOf('mn-chat-panel')).toBe('stamp') // resolves, but NOT registered
    expect(isRegisteredComponent('')).toBe(false)
    expect(isRegisteredComponent('anything-unknown')).toBe(false)
  })

  it('does not report inherited Object.prototype keys as registered', () => {
    expect(isRegisteredComponent('toString')).toBe(false)
    expect(isRegisteredComponent('constructor')).toBe(false)
    expect(isRegisteredComponent('hasOwnProperty')).toBe(false)
  })
})

describe('component-library — interpreter consumes the folded table (no drift)', () => {
  it('interpreter.persistenceOf is the SAME function as the library export', () => {
    // The fold's whole point: one table, one lookup — re-exported, not copied.
    expect(interpreterPersistenceOf).toBe(persistenceOf)
  })

  it('agrees on every registered tag and on the default', () => {
    for (const tag of ['mn-document-editor', 'mn-graph-panel', 'mn-vtuber', 'mn-chat-panel', 'x-unknown']) {
      expect(interpreterPersistenceOf(tag)).toBe(persistenceOf(tag))
    }
  })
})
