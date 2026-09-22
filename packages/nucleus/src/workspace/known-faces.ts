/**
 * known-faces.ts — the FROZEN registry of canonical face ids (the face catalog).
 *
 * A `ConfigEdge` names its endpoints in the `face:<id>` id-space (DISTINCT from
 * panel ids). At runtime the edge-interpreter resolves each endpoint against the
 * shell's FacePort map and SILENTLY skips an edge whose from/to isn't a key
 * (edge-interpreter.ts) — so a typo'd or bogus face id fails soft, invisibly.
 * validateConfig's I8 rule closes that gap at the COMMIT gate by checking every
 * edge endpoint against this set, exactly as I7 makes the commit gate agree with
 * stampPanelBody's render gate.
 *
 * HONEST CAVEAT — this set is a MIRROR, not the source of truth. The authoritative
 * face registry is the shell's EDGE_FACES adapter map (organism, main.ts), which
 * validateConfig (pure nucleus) cannot see. The two MUST be kept in lockstep — the
 * same coupling class as PANEL_ID_TO_SUX ↔ the shell's panel wiring: if the shell
 * adds a face here but not to EDGE_FACES, I8 accepts an edge that silently no-ops
 * at install; if the shell adds a face to EDGE_FACES but not here, I8 REJECTS a
 * legitimately-wired edge at commit. Update both together.
 *
 * PURE: a frozen literal, mirroring the frozenSet pattern of KNOWN_COMPONENTS. The
 * nucleus never reads the DOM or the shell's adapter map.
 */

/**
 * The canonical face ids, mirroring the key set of the shell's EDGE_FACES map:
 * `face:inspector`, `face:comments`, `face:graph`, `face:editor` (Tier-A) plus
 * `face:sidebar` (Tier-B).
 */
const KNOWN_FACE_ID_LIST: readonly string[] = [
  'face:inspector',
  'face:comments',
  'face:graph',
  'face:editor',
  'face:sidebar',
]

/**
 * Build a TRULY-immutable ReadonlySet.
 *
 * GOTCHA (same as known-components.frozenSet): `Object.freeze(new Set(...))` is
 * NOT immutable — freeze only touches own properties, leaving `[[SetData]]`
 * writable so `.add()`/`.delete()`/`.clear()` still mutate. We override the three
 * mutators to throw and freeze the wrapper, yielding a set that genuinely cannot
 * be poisoned at runtime.
 */
function frozenSet(ids: readonly string[]): ReadonlySet<string> {
  const set = new Set<string>(ids)
  const reject = (op: string) => (): never => {
    throw new TypeError(`KNOWN_FACE_IDS is immutable: ${op} is not permitted`)
  }
  Object.defineProperties(set, {
    add: { value: reject('add'), configurable: false, writable: false },
    delete: { value: reject('delete'), configurable: false, writable: false },
    clear: { value: reject('clear'), configurable: false, writable: false },
  })
  return Object.freeze(set)
}

/**
 * The FROZEN set of registered face ids an edge may reference. Membership is an
 * O(1) `.has()`; `.add`/`.delete`/`.clear` THROW so the module-global cannot be
 * mutated at runtime. Consumed by validateConfig's I8 face-resolvability rule.
 */
export const KNOWN_FACE_IDS: ReadonlySet<string> = frozenSet(KNOWN_FACE_ID_LIST)
