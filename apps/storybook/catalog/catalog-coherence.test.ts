/**
 * catalog-coherence.test.ts — the guard that keeps the one catalog's two faces
 * coherent (iteration 3c, the load-bearing test per Vera).
 *
 * The rule: Storybook and the component-library MANIFEST are ONE catalog. So:
 *
 *   1. EVERY manifested component (a key of COMPONENT_LIBRARY) MUST appear as a
 *      catalog entry — otherwise the manifest knows a component the catalog can't
 *      show.
 *   2. EVERY manifested component MUST have its own generated Storybook story
 *      (PER_ENTRY_STORIES) — the literal "every manifested component has a story"
 *      requirement, beyond the index grid.
 *   3. The catalog entries and the generated stories MUST agree exactly (no story
 *      without an entry, no entry without a story) — the two faces are the same
 *      catalog, not two hand-kept lists.
 *
 * Because the catalog story GENERATES its grid + per-entry bodies from
 * CATALOG_ENTRIES (which is derived from COMPONENT_LIBRARY), the only way this
 * test can fail is if someone adds a manifest row WITHOUT adding the matching
 * static CSF export — exactly the drift we want caught. This test is the reason
 * the hand-listed CSF exports in catalog.stories.ts are safe.
 */

import { describe, it, expect } from 'vitest'

// The MANIFEST face — the frozen engine table (source of WHAT exists).
import { COMPONENT_LIBRARY, isRegisteredComponent } from '@shrubbery/nucleus'

// The derived single catalog (the seam both faces read).
import {
  CATALOG_ENTRIES,
  MANIFESTED_TAGS,
  catalogEntryFor,
  isBuilt,
  storyExportName,
} from './catalog-model.js'

// The STORYBOOK face — the actual generated story exports (imported, not copied).
// Importing the story module also runs the @shrubbery/components side-effect, so
// isBuilt() reflects the real custom-element registry below. We import the whole
// namespace so we can check the per-entry static CSF exports by derived name.
import * as CatalogStories from '../stories/catalog.stories.js'
import type { StoryObj } from '@storybook/web-components'

const Index = CatalogStories.Index

/** The per-entry CSF stories, keyed by tag, read from the ACTUAL module exports. */
const PER_ENTRY_STORIES: Record<string, StoryObj> = Object.fromEntries(
  CATALOG_ENTRIES.map(e => [
    e.tag,
    (CatalogStories as Record<string, StoryObj>)[storyExportName(e.tag)],
  ]),
)

describe('catalog coherence — manifest ⇄ catalog entries', () => {
  it('every manifested component (COMPONENT_LIBRARY key) is a catalog entry', () => {
    for (const tag of MANIFESTED_TAGS) {
      const entry = catalogEntryFor(tag)
      expect(entry, `manifested tag ${tag} must have a catalog entry`).toBeDefined()
      expect(entry!.manifested).toBe(true)
    }
  })

  it('MANIFESTED_TAGS is exactly the COMPONENT_LIBRARY keys', () => {
    expect([...MANIFESTED_TAGS].sort()).toEqual(Object.keys(COMPONENT_LIBRARY).sort())
  })

  it('each catalog entry carries the manifest persistence class', () => {
    for (const entry of CATALOG_ENTRIES) {
      // manifested entries report a real (possibly non-default) class; built
      // chrome that is not manifested still resolves to the safe 'stamp' default.
      expect(['stamp', 'persistent-relocatable', 'persistent-non-relocatable']).toContain(
        entry.persistence,
      )
      expect(entry.manifested).toBe(isRegisteredComponent(entry.tag))
    }
  })
})

describe('catalog coherence — manifest ⇄ generated stories', () => {
  it('every manifested component has its OWN generated story', () => {
    for (const tag of MANIFESTED_TAGS) {
      const story = PER_ENTRY_STORIES[tag]
      expect(story, `manifested tag ${tag} must have a per-entry story`).toBeDefined()
      // The story renders the real tag (its name is the tag) — not a mock arg bag.
      expect(story.name).toBe(tag)
      expect(typeof story.render).toBe('function')
    }
  })

  it('the per-entry stories cover EXACTLY the catalog entries (no drift)', () => {
    const storyTags = Object.keys(PER_ENTRY_STORIES).sort()
    const entryTags = CATALOG_ENTRIES.map(e => e.tag).sort()
    expect(storyTags).toEqual(entryTags)
  })

  it('every generated story has a matching static CSF export name', () => {
    // Assert the derived export name for each tag is actually exported by the
    // story module — catches a manifest row added without a matching
    // `export const Xxx = memberStory(...)`.
    const mod = CatalogStories as Record<string, unknown>
    for (const tag of CATALOG_ENTRIES.map(e => e.tag)) {
      const name = storyExportName(tag)
      expect(mod[name], `expected static CSF export "${name}" for tag ${tag}`).toBeDefined()
    }
  })

  it('the story module exports ONLY the default meta + valid stories (no stray exports)', () => {
    // A .stories.ts file may export only `default` + story objects; a stray
    // helper export would be auto-discovered as a broken story. Every named
    // export here must be a Story (have a `render` function).
    const mod = CatalogStories as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (name === 'default') continue
      const story = value as { render?: unknown }
      expect(typeof story?.render, `export "${name}" must be a story (have render)`).toBe(
        'function',
      )
    }
  })

  it('the Index story exists and renders a TemplateResult (the catalog-from-manifest)', () => {
    expect(Index).toBeDefined()
    expect(typeof Index.render).toBe('function')
    const result = Index.render!({} as never, {} as never)
    expect(result).toBeTruthy()
  })
})

describe('catalog coherence — built vs unbuilt faces (honest, never faked)', () => {
  it('built chrome tags are actually registered custom elements', () => {
    // After importing the story module (side-effect), the chrome is upgraded.
    expect(isBuilt('mn-top-bar')).toBe(true)
    expect(isBuilt('mn-bottom-bar')).toBe(true)
  })

  it('manifested panel built-state is honest per tag', () => {
    // mn-document-editor remains inert here because the real persistent editor
    // lift is sh-editor-host. mn-graph-panel and mn-vtuber are built panels.
    expect(isBuilt('mn-document-editor')).toBe(false)
    expect(isBuilt('mn-graph-panel')).toBe(true)
    expect(isBuilt('mn-vtuber')).toBe(true)
  })

  it('every manifest tag is presented under the manifest-panel face', () => {
    for (const tag of MANIFESTED_TAGS) {
      expect(catalogEntryFor(tag)!.face).toBe('manifest-panel')
    }
  })
})

describe('catalog coherence — the iter-4a general primitives are catalogued', () => {
  // The lifted + generalized, skin-aware primitives (the load-bearing iter-4a
  // deliverable). They MUST be in the one catalog, under the general-primitive
  // face, as REAL built custom elements (never inert) — so the catalog has both
  // faces (manifest + Storybook) for them too.
  const PRIMITIVES = [
    'mn-chip',
    'mn-badge',
    'mn-sparkline',
    'mn-ribbon',
    'mn-card',
    'mn-relations',
    'mn-graph',
    'mn-graph-three',
    'mn-spinner',
    'mn-loading',
    'mn-empty-state',
    'mn-artifact-view',
    'mn-artifact-editor',
    'mn-excalidraw-canvas',
    'mn-doc-history-panel',
    'mn-original-viewer',
    'mn-comment-popover',
    'wf-choreograph-view',
    'wf-mission-control',
    'wf-studio-shell',
    'mn-input',
    'mn-textarea',
    'mn-search-input',
    'mn-tooltip',
    'mn-avatar',
    'mn-panel-header',
    'mn-dropdown-button',
    'mn-inline-edit',
    'mn-toast',
    'mn-modal',
    'mn-dialog',
    'mn-toolbar-overflow',
    'mn-tag-chip-specimen',
    'mn-tag-autocomplete-popover',
    'mn-calendar-event-specimen',
    'mn-daily-note-header',
    'mn-daily-note-row',
    'mn-month-popover',
    'mn-context-menu',
    'mn-input-dialog',
    'mn-confirmation-dialog',
    'mn-shortcuts-dialog',
    'mn-advanced-wire-menu',
    'mn-wire-menu-dropdown',
    'mn-wire-picker',
    'mn-wikilink-picker',
    'mn-node-link-picker',
    'mn-citation-picker',
    'mn-zotero-library-panel',
    'mn-zotero-source-workbench',
    'mn-wire-radial-overlay',
    'mn-research-source-chip',
    'mn-research-source-card',
    'mn-research-run-trace',
    'mn-research-workspace',
    'mn-document-switcher',
    'mn-settings-page',
    'mn-ops-health-page',
    'mn-consent-banner',
    'mn-upgrade-banner',
    'mn-storage-banner',
    'mn-cloud-mode-pill',
    'mn-cloud-mode-panel',
    'mn-tts-player',
    'mn-feedback-form',
    'mn-export-dialog',
    'mn-mobile-tabs',
    'mn-mobile-file-list',
    'mn-error-boundary',
    'mn-public-shell',
    'mn-auth-page',
    'mn-sign-in-form',
    'mn-sign-up-form',
    'mn-verify-email-form',
    'garden-hero-canvas',
    'sophia-hero-canvas',
    'garden-landing',
    'sophia-labs-landing',
  ]

  it('each primitive has a catalog entry under the general-primitive face', () => {
    for (const tag of PRIMITIVES) {
      const entry = catalogEntryFor(tag)
      expect(entry, `${tag} must have a catalog entry`).toBeDefined()
      expect(entry!.face).toBe('general-primitive')
      // not engine-manifested (they are presentation primitives, not panels).
      expect(entry!.manifested).toBe(false)
    }
  })

  it('each primitive is a REAL, registered (built) custom element — never inert', () => {
    for (const tag of PRIMITIVES) {
      expect(isBuilt(tag), `${tag} must be a built @customElement`).toBe(true)
    }
  })

  it('each primitive has its OWN generated per-entry story', () => {
    for (const tag of PRIMITIVES) {
      const name = storyExportName(tag)
      const story = (CatalogStories as Record<string, StoryObj>)[name]
      expect(story, `${tag} → export ${name} must exist`).toBeDefined()
      expect(story.name).toBe(tag)
      expect(typeof story.render).toBe('function')
    }
  })
})
