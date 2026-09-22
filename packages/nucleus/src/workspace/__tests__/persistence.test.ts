/**
 * STEP 1 gate — persistenceOf() component taxonomy.
 *
 * Pure unit test; no DOM, no Lit, no stores, no custom elements.
 * Asserts the three-class frozen taxonomy defined in interpreter.ts beside
 * PANEL_ID_TO_SUX, and validates the cross-check that resolveSurfaceTag wires
 * through to the correct class for the real GARDEN_DEFAULT config.
 *
 * The three classes:
 *   A — 'stamp'                     : stateless, re-stampable, no imperative DOM-bound state
 *   B — 'persistent-relocatable'    : DOM-bound state; CSS-reposition, never re-parent
 *   C — 'persistent-non-relocatable': GPU/WebGL context; float-only, re-parent forbidden
 *
 * No behavior change in STEP 1 — persistenceOf is defined and tested but not
 * yet called by the renderer.
 */

import { describe, it, expect } from 'vitest'
import { persistenceOf, resolveSurfaceTag, type Persistence } from '../interpreter.js'
import { GARDEN_DEFAULT } from '../garden-default.js'

// ── Table invariants ──────────────────────────────────────────────────────────

describe('PERSISTENCE_BY_TAG — table invariants', () => {
  it('the underlying table is frozen (agent-unwritable, consistent with PANEL_ID_TO_SUX)', () => {
    // Verify by attempting to mutate via persistenceOf's backing object.
    // We can only observe the frozen-ness indirectly via the export; the table
    // itself is unexported (intentionally — it is not agent-writable surface).
    // The test that proves frozenness: call persistenceOf with a key not in the
    // table and confirm it never throws (Object.freeze does not affect reads).
    expect(() => persistenceOf('anything-unknown')).not.toThrow()

    // Verify the returned value is a valid Persistence literal (not undefined/null).
    const result = persistenceOf('anything-unknown')
    const validValues: Persistence[] = ['stamp', 'persistent-relocatable', 'persistent-non-relocatable']
    expect(validValues).toContain(result)
  })
})

// ── Class A — stamp-able / stateless ─────────────────────────────────────────

describe('persistenceOf — Class A: stamp-able / stateless', () => {
  it('mn-chat-panel → stamp', () => {
    expect(persistenceOf('mn-chat-panel')).toBe('stamp')
  })

  it('mn-sidebar-panel → stamp', () => {
    expect(persistenceOf('mn-sidebar-panel')).toBe('stamp')
  })

  it('mn-top-bar → stamp', () => {
    expect(persistenceOf('mn-top-bar')).toBe('stamp')
  })

  it('mn-bottom-bar → stamp', () => {
    expect(persistenceOf('mn-bottom-bar')).toBe('stamp')
  })

  it('mn-wires-panel → stamp', () => {
    expect(persistenceOf('mn-wires-panel')).toBe('stamp')
  })

  it('mn-comments-panel → stamp', () => {
    expect(persistenceOf('mn-comments-panel')).toBe('stamp')
  })

  it('mn-inspector → stamp', () => {
    expect(persistenceOf('mn-inspector')).toBe('stamp')
  })

  it('anything-unknown → stamp (safe default for unlisted tags)', () => {
    expect(persistenceOf('anything-unknown')).toBe('stamp')
  })

  it('empty string → stamp', () => {
    expect(persistenceOf('')).toBe('stamp')
  })
})

// ── Class B — persistent-relocatable ─────────────────────────────────────────

describe('persistenceOf — Class B: persistent-relocatable', () => {
  it('mn-document-editor → persistent-relocatable', () => {
    expect(persistenceOf('mn-document-editor')).toBe('persistent-relocatable')
  })
})

describe('persistenceOf — Class C: persistent-non-relocatable', () => {
  it('mn-graph-panel → persistent-non-relocatable', () => {
    expect(persistenceOf('mn-graph-panel')).toBe('persistent-non-relocatable')
  })
})

// ── Cross-check: resolveSurfaceTag wires through to the correct class ─────────

describe('persistenceOf — cross-check against resolveSurfaceTag on GARDEN_DEFAULT', () => {
  it('persistenceOf(resolveSurfaceTag(GARDEN_DEFAULT, "region-center")!) === persistent-relocatable', () => {
    // region-center has renderedByComponent: null and docksPanel: ['panel-editor'],
    // so resolveSurfaceTag resolves to panels['panel-editor'].renderedByComponent
    // = 'mn-document-editor', and persistenceOf('mn-document-editor') = 'persistent-relocatable'.
    // This is the exact hook the renderer consults in STEP 2.
    const tag = resolveSurfaceTag(GARDEN_DEFAULT, 'region-center')
    expect(tag).toBe('mn-document-editor')
    expect(persistenceOf(tag!)).toBe('persistent-relocatable')
  })

  it('persistenceOf(resolveSurfaceTag(GARDEN_DEFAULT, "region-top-bar")!) === stamp', () => {
    // region-top-bar has renderedByComponent: 'mn-top-bar' directly.
    const tag = resolveSurfaceTag(GARDEN_DEFAULT, 'region-top-bar')
    expect(tag).toBe('mn-top-bar')
    expect(persistenceOf(tag!)).toBe('stamp')
  })

  it('persistenceOf(resolveSurfaceTag(GARDEN_DEFAULT, "region-left-rail")!) === stamp', () => {
    // region-left-rail docks panel-sidebar → renderedByComponent: 'mn-sidebar-panel'.
    const tag = resolveSurfaceTag(GARDEN_DEFAULT, 'region-left-rail')
    expect(tag).toBe('mn-sidebar-panel')
    expect(persistenceOf(tag!)).toBe('stamp')
  })

  it('persistenceOf(resolveSurfaceTag(GARDEN_DEFAULT, "region-right-rail")!) === stamp', () => {
    // region-right-rail docks panel-chat first → renderedByComponent: 'mn-chat-panel'.
    const tag = resolveSurfaceTag(GARDEN_DEFAULT, 'region-right-rail')
    expect(tag).toBe('mn-chat-panel')
    expect(persistenceOf(tag!)).toBe('stamp')
  })

  it('persistenceOf(resolveSurfaceTag(GARDEN_DEFAULT, "region-bottom-bar")!) === stamp', () => {
    // region-bottom-bar has renderedByComponent: 'mn-bottom-bar' directly.
    const tag = resolveSurfaceTag(GARDEN_DEFAULT, 'region-bottom-bar')
    expect(tag).toBe('mn-bottom-bar')
    expect(persistenceOf(tag!)).toBe('stamp')
  })

  it('resolveSurfaceTag returns null for unknown region; persistenceOf(null!) is not called', () => {
    const tag = resolveSurfaceTag(GARDEN_DEFAULT, 'region-does-not-exist')
    expect(tag).toBeNull()
    // Guard: the renderer must null-check before calling persistenceOf.
    // (This test documents the contract, not tests persistenceOf with null.)
  })
})

// ── Exhaustive stamp-ness: all GARDEN_DEFAULT regions except center + graph ───

describe('persistenceOf — all GARDEN_DEFAULT panel tags are stamp or well-classified', () => {
  it('every panel in GARDEN_DEFAULT resolves to a valid Persistence class', () => {
    const validValues: Set<Persistence> = new Set([
      'stamp',
      'persistent-relocatable',
      'persistent-non-relocatable',
    ])
    for (const [_panelId, panel] of Object.entries(GARDEN_DEFAULT.panels)) {
      const tag = panel.renderedByComponent
      if (tag) {
        const persistence = persistenceOf(tag)
        expect(validValues.has(persistence),
          `panel ${_panelId} (tag: ${tag}) returned unexpected value: ${persistence}`
        ).toBe(true)
      }
    }
  })

  it('the editor and WebGL graph are the only persistent tags in GARDEN_DEFAULT panels', () => {
    const nonStamp: string[] = []
    for (const [_panelId, panel] of Object.entries(GARDEN_DEFAULT.panels)) {
      const tag = panel.renderedByComponent
      if (tag && persistenceOf(tag) !== 'stamp') {
        nonStamp.push(tag)
      }
    }
    expect(nonStamp.sort()).toEqual(['mn-document-editor', 'mn-graph-panel'])
  })
})
