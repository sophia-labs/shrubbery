/**
 * component-library.ts — the folded component-library manifest (iteration 1a).
 *
 * The SINGLE source of per-tag component metadata for the engine. It owns:
 *   - `COMPONENT_LIBRARY`: tag → { persistence, ... } (the registered components).
 *   - `persistenceOf(tag)`: the three-class persistence taxonomy lookup.
 *   - `isRegisteredComponent(tag)`: whether a tag is a vetted, known component.
 *
 * This subsumes the former two-table arrangement (interpreter's inline
 * `PERSISTENCE_BY_TAG` + the standalone `component-library/manifest.ts` stub):
 * those two had to agree by hand. Now `interpreter.ts` imports `persistenceOf`
 * from here, so there is exactly one table and it cannot drift.
 *
 * This is the seam where Emporium packs will later bind components BY DATA. For
 * now it is FIXED CODE, not agent-writable: the agent reshapes WHICH panel docks
 * WHERE via config; it never rewrites this table nor how a tag binds its props.
 *
 * Pure: no DOM, no stores, no custom-element registration side-effects.
 */

/**
 * The three-class component persistence taxonomy.
 *
 * | Class | Value | Definition | Engine treatment |
 * |---|---|---|---|
 * | A | 'stamp' | No DOM-identity-bound imperative state; pure function of props/stores. | Stamped in-tree via stampPanelBody/resolveSurfaceTag. Re-stamp on rearrange is free. |
 * | B | 'persistent-relocatable' | DOM-bound imperative state that survives iff the node survives; content externalized (CRDT) so a re-mount is also recoverable. | Position-anchor in the layout; a positioning authority owns the one live node; CSS reposition, NEVER appendChild/re-parent. |
 * | C | 'persistent-non-relocatable' | Imperative state that cannot survive any re-parent (GPU/WebGL context bound to the canvas). Same as B but float-only — the slot fast-path is forbidden. | Float-only over the measured anchor box; re-parent is forbidden. |
 *
 * The law: for classes B and C, the layout emits a position anchor and NEVER
 * owns the live node. It stamps and owns the node only for class A. B and C
 * differ solely in whether the slot fast-path is available (B: yes, later; C: never).
 */
export type Persistence = 'stamp' | 'persistent-relocatable' | 'persistent-non-relocatable'

/** A vetted component-library entry: a tag plus its declared engine metadata. */
export interface ComponentLibraryEntry {
  /** The custom-element tag, e.g. 'mn-graph-panel'. */
  readonly tag: string
  /** The engine persistence class (drives stamp vs. position-anchor vs. float). */
  readonly persistence: Persistence
}

/**
 * The FROZEN, code-level, NOT-agent-writable component library.
 *
 * Engine-manifested panel tags are listed here even when their persistence is
 * the Class-A default. Any tag absent here still resolves to Class A ('stamp')
 * via `persistenceOf`'s fallback — the safe default (a component not listed here
 * is assumed stateless and re-stampable).
 *
 * Note: mn-document-editor remains Class B (TipTap DOM-bound state). mn-vtuber
 * and mn-graph-panel are Class C because their live surfaces own WebGL canvases
 * and must never be re-parented by the layout arm. Controlled props keep domain
 * authority outside those components; they do not make a GPU context stampable.
 */
export const COMPONENT_LIBRARY: Readonly<Record<string, ComponentLibraryEntry>> = Object.freeze({
  'mn-document-editor': { tag: 'mn-document-editor', persistence: 'persistent-relocatable' }, // Class B
  'mn-graph-panel': { tag: 'mn-graph-panel', persistence: 'persistent-non-relocatable' }, // Class C — Garden WebGL scene
  'mn-vtuber': { tag: 'mn-vtuber', persistence: 'persistent-non-relocatable' }, // Class C — WebGL/VRM canvas
})

/**
 * Return the persistence class for a component tag.
 *
 * Pure; no DOM, no stores. Returns 'stamp' (Class A) for any tag not in the
 * library — the safe default: a component not listed here is assumed stateless
 * and re-stampable.
 */
export function persistenceOf(tag: string): Persistence {
  return COMPONENT_LIBRARY[tag]?.persistence ?? 'stamp'
}

/**
 * Whether `tag` is an explicitly-registered component-library entry.
 *
 * Pure; no DOM. NOTE: this is distinct from `persistenceOf` returning 'stamp' —
 * an UNregistered tag also resolves to 'stamp' by the safe default, so a true
 * Class-A registered component and an unknown tag both report 'stamp'. Use this
 * when you need to know whether the library KNOWS the tag at all (e.g. the
 * Emporium-pack seam), not merely its (possibly defaulted) persistence class.
 */
export function isRegisteredComponent(tag: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMPONENT_LIBRARY, tag)
}
