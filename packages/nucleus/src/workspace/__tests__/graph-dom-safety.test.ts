/**
 * graph→DOM boundary safety — the tag-injection + unbounded-recursion defenses.
 *
 * The graph is untrusted: a WorkspaceConfig arrives from the cell over a READ
 * path that may skip validateConfig. Three defenses, all BY CONSTRUCTION inside
 * the nucleus, are exercised here with REAL inputs (no mocks):
 *
 *   1. TAG GRAMMAR AT unsafeStatic — stampPanelBody stamps a tag verbatim ONLY
 *      when it passes the render gate (grammar + catalog). A malicious/off-catalog
 *      tag resolves to an inert <mn-inert-placeholder>, so the rejected string is
 *      an escaped attribute value and NEVER reaches unsafeStatic.
 *   2. CYCLE/DEPTH GUARD IN planFor — a cyclic or pathologically deep childRegion
 *      spine returns a bounded plan instead of stack-overflowing (holds EVEN IF
 *      validateConfig was never called).
 *   3. CATALOG CHECK IN THE VALIDATOR — validateConfig I7 rejects off-catalog /
 *      non-grammar panel + region tags, so the commit gate agrees with the render
 *      gate. (config.renderedByComponent, the never-stamped 'app-shell' root, is
 *      deliberately out of scope.)
 *
 * happy-dom is the vitest environment, so the injection test also RENDERS the
 * template into a real container and asserts no attacker markup materialized.
 */

import { describe, it, expect } from 'vitest'
import { render } from 'lit'
import { html as staticHtml, unsafeStatic } from 'lit/static-html.js'
import { stampPanelBody, planFor, type SplitNode, type WorkspaceSpinePlanNode } from '../interpreter.js'
import { validateConfig } from '../validate.js'
import { isRenderableComponentTag, isValidCustomElementTag, isKnownComponent } from '../known-components.js'
import { GARDEN_DEFAULT } from '../garden-default.js'
import { GARDEN_VARIANT } from '../garden-variant.js'
import { minimalTextPanelConfig, grownTextPanelConfig } from '../minimal-text-panel.js'
import type { RegionConfig, WorkspaceConfig } from '../types.js'

/** The single injection payload the mission calls out. */
const INJECTION = 'div><img src=x onerror=alert(1)>'

/** Clone GARDEN_DEFAULT into a mutable plain object for surgery. */
function mutableClone(): { config: WorkspaceConfig; regions: Record<string, RegionConfig> } {
  const regions: Record<string, RegionConfig> = {}
  for (const id of Object.keys(GARDEN_DEFAULT.regions)) {
    regions[id] = { ...GARDEN_DEFAULT.regions[id] }
  }
  const config = {
    ...GARDEN_DEFAULT,
    regions,
    rootRegions: [...GARDEN_DEFAULT.rootRegions],
  } as WorkspaceConfig
  return { config, regions }
}

// ── 1. TAG GRAMMAR / INJECTION AT unsafeStatic ────────────────────────────────

describe('stampPanelBody — never feeds an unvalidated string to unsafeStatic', () => {
  it('a valid known tag is stamped verbatim (baked into the static template)', () => {
    // The known tag lands in the static `strings` array — DOM-identical to the
    // hand-written literal `<mn-card></mn-card>`.
    const result = stampPanelBody('mn-card')
    expect(result.strings.join('')).toBe('<mn-card></mn-card>')
  })

  it('an injected fragment yields a placeholder — the payload is NOT in the static template', () => {
    const result = stampPanelBody(INJECTION)
    const staticPart = result.strings.join('')
    // The static template is the fixed placeholder; the injected markup is absent.
    expect(staticPart).toContain('mn-inert-placeholder')
    expect(staticPart).not.toContain('<img')
    expect(staticPart).not.toContain('onerror')
    // The rejected string survives only as a BOUND value (Lit escapes it at render).
    expect(result.values).toContain(INJECTION)
  })

  it('rendering the injected-tag template produces NO <img> in the DOM (escaped, inert)', () => {
    const container = document.createElement('div')
    render(stampPanelBody(INJECTION), container)
    // The inert placeholder mounted; the attacker element did not.
    expect(container.querySelector('mn-inert-placeholder')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    // The payload lives only as an escaped attribute value, never as markup.
    const placeholder = container.querySelector('mn-inert-placeholder')!
    expect(placeholder.getAttribute('data-rejected-tag')).toBe(INJECTION)
  })

  it('rendering a valid known tag DOES mount that element', () => {
    const container = document.createElement('div')
    render(stampPanelBody('mn-card'), container)
    expect(container.querySelector('mn-card')).not.toBeNull()
    expect(container.querySelector('mn-inert-placeholder')).toBeNull()
  })

  it('off-catalog but grammar-valid tags (e.g. an unregistered custom element) are placeholdered', () => {
    // 'x-evil' matches the custom-element grammar but is NOT in the catalog.
    expect(isValidCustomElementTag('x-evil')).toBe(true)
    expect(isKnownComponent('x-evil')).toBe(false)
    const result = stampPanelBody('x-evil')
    expect(result.strings.join('')).toContain('mn-inert-placeholder')
    expect(result.strings.join('')).not.toContain('x-evil')
  })

  it('built-in HTML tags without a hyphen (e.g. "script") fail the grammar and are placeholdered', () => {
    expect(isValidCustomElementTag('script')).toBe(false)
    const result = stampPanelBody('script')
    expect(result.strings.join('')).toContain('mn-inert-placeholder')
    expect(result.strings.join('')).not.toContain('<script')
  })

  it('CONTRAST: the raw unsafeStatic primitive WOULD have injected — proving the gate matters', () => {
    // Documents the vulnerability the gate closes: fed the payload directly,
    // unsafeStatic bakes it into the static template as live markup.
    const t = unsafeStatic(INJECTION)
    const raw = staticHtml`<${t}></${t}>`
    expect(raw.strings.join('')).toContain('<img')
    // stampPanelBody, given the same payload, does NOT.
    expect(stampPanelBody(INJECTION).strings.join('')).not.toContain('<img')
  })
})

// ── 2. CYCLE / DEPTH GUARD IN planFor ─────────────────────────────────────────

/** Count spine nodes without assuming acyclicity (bounded by MAX_SPINE_DEPTH). */
function spineLength(node: WorkspaceSpinePlanNode): number {
  let n = 1
  let cur: WorkspaceSpinePlanNode = node
  while (cur.kind === 'split') {
    n += 1
    cur = (cur as SplitNode).child
    if (n > 5000) break // test-side safety net; the guard should stop us far sooner
  }
  return n
}

describe('planFor — bounded on cyclic / pathologically deep configs (no stack overflow)', () => {
  it('a 2-cycle (a↔b) returns a bounded plan WITHOUT throwing', () => {
    // Build a cyclic childRegion chain directly — validateConfig is NOT called,
    // proving the interpreter guard is independent defense in depth.
    const regions: Record<string, RegionConfig> = {
      a: { ...GARDEN_DEFAULT.regions['region-left-rail'], id: 'a', childRegion: 'b', resizable: true },
      b: { ...GARDEN_DEFAULT.regions['region-center'], id: 'b', childRegion: 'a', resizable: false },
    }
    const config = { ...GARDEN_DEFAULT, regions, rootRegions: ['a'] } as WorkspaceConfig

    let plan: ReturnType<typeof planFor> | undefined
    expect(() => { plan = planFor(config) }).not.toThrow()
    expect(plan!.spineHeadId).toBe('a')
    // Bounded: the walk terminated instead of recursing forever.
    expect(spineLength(plan!.spine)).toBeLessThan(10)
  })

  it('a self-loop (a→a) returns a bounded plan WITHOUT throwing', () => {
    const regions: Record<string, RegionConfig> = {
      a: { ...GARDEN_DEFAULT.regions['region-left-rail'], id: 'a', childRegion: 'a', resizable: true },
    }
    const config = { ...GARDEN_DEFAULT, regions, rootRegions: ['a'] } as WorkspaceConfig
    expect(() => planFor(config)).not.toThrow()
    expect(spineLength(planFor(config).spine)).toBeLessThan(10)
  })

  it('a pathologically deep (10k) linear spine returns WITHOUT overflowing the stack', () => {
    // A 10,000-deep chain would blow a naive recursion; the depth cap bounds it.
    const regions: Record<string, RegionConfig> = {}
    const N = 10_000
    for (let i = 0; i < N; i++) {
      regions[`r${i}`] = {
        ...GARDEN_DEFAULT.regions['region-center'],
        id: `r${i}`,
        childRegion: i < N - 1 ? `r${i + 1}` : null,
        resizable: i === 0,
        sizeFraction: 0.5,
      }
    }
    const config = { ...GARDEN_DEFAULT, regions, rootRegions: ['r0'] } as WorkspaceConfig
    let plan: ReturnType<typeof planFor> | undefined
    expect(() => { plan = planFor(config) }).not.toThrow()
    // Bounded by MAX_SPINE_DEPTH (1024), NOT the full 10k depth.
    expect(spineLength(plan!.spine)).toBeLessThanOrEqual(1025)
  })
})

// ── 3. CATALOG CHECK IN THE VALIDATOR (I7) ────────────────────────────────────

describe('validateConfig I7 — rejects off-catalog / non-grammar stamped tags', () => {
  it('rejects an injected fragment as a region.renderedByComponent', () => {
    const { config, regions } = mutableClone()
    regions['region-top-bar'] = { ...regions['region-top-bar'], renderedByComponent: INJECTION }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I7/)
  })

  it('rejects a truthy off-catalog tag ("x-evil") that PASSES I5 as a region tag', () => {
    const { config, regions } = mutableClone()
    regions['region-top-bar'] = { ...regions['region-top-bar'], renderedByComponent: 'x-evil' }
    const result = validateConfig(config)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I7/)
  })

  it('rejects an off-catalog panel.renderedByComponent', () => {
    const { config } = mutableClone()
    const panels = { ...config.panels, 'panel-chat': { ...config.panels['panel-chat'], renderedByComponent: 'not-a-real-component' } }
    const result = validateConfig({ ...config, panels } as WorkspaceConfig)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/I7/)
  })

  it('does NOT gate the workspace-root config.renderedByComponent (app-shell is never stamped)', () => {
    // 'app-shell' is off-catalog but is the host shell element, never fed to
    // stampPanelBody — GARDEN_DEFAULT carries it and passes.
    expect(isKnownComponent(GARDEN_DEFAULT.renderedByComponent)).toBe(false)
    expect(validateConfig(GARDEN_DEFAULT)).toEqual({ ok: true })
  })
})

// ── 4. SEED SAFETY — every legitimate seed tag still renders unchanged ─────────

/** Collect every tag that flows to stampPanelBody: region + panel renderedByComponent. */
function stampedTags(config: WorkspaceConfig): string[] {
  const tags: string[] = []
  for (const r of Object.values(config.regions)) {
    if (r.renderedByComponent !== null) tags.push(r.renderedByComponent)
  }
  for (const p of Object.values(config.panels)) tags.push(p.renderedByComponent)
  return tags
}

describe('seed safety — every committed-seed tag passes the render gate unchanged', () => {
  const seeds: Array<{ name: string; config: WorkspaceConfig }> = [
    { name: 'GARDEN_DEFAULT', config: GARDEN_DEFAULT },
    { name: 'GARDEN_VARIANT', config: GARDEN_VARIANT },
    { name: 'minimalTextPanelConfig', config: minimalTextPanelConfig() },
    { name: 'grownTextPanelConfig', config: grownTextPanelConfig() },
  ]

  for (const { name, config } of seeds) {
    it(`${name}: every stamped tag is renderable (grammar + catalog) and stamps verbatim`, () => {
      for (const tag of stampedTags(config)) {
        expect(isRenderableComponentTag(tag)).toBe(true)
        // And stampPanelBody emits it verbatim, not a placeholder.
        expect(stampPanelBody(tag).strings.join('')).toBe(`<${tag}></${tag}>`)
      }
    })

    it(`${name}: validateConfig passes (I7 admits every legitimate seed)`, () => {
      expect(validateConfig(config)).toEqual({ ok: true })
    })
  }
})
