/**
 * set-appearance.ts — the Atelier's first agent affordance on the grow engine
 * (S2 of the ratified Atelier design, sophia-code-lab graph §2): the verb by
 * which an agent styles its own avatar (tints + expression) through the
 * curated gate, never raw triples.
 *
 * `set_vtuber_appearance` targets an EXISTING `VtuberControlChannel` in a
 * workspace's `:ux:control` named graph (vtuber-control-rdf.ts) and replaces
 * exactly the caller-provided subset of its styling predicates — never
 * additive, never open-ended:
 *
 *   TARGET     the channel, named directly (channelId) or resolved the same
 *              way `selectVtuberControlChannel` resolves a rendered surface
 *              (panelId, then regionId). Absent/unknown target → REJECT.
 *   FIELDS     any non-empty subset of { expression, accentTint, eyeTint,
 *              hairTint, outfitTint, skinWarmth } — the closed styling
 *              surface. Malformed hex, out-of-range skinWarmth, an
 *              off-vocabulary expression, an empty edit, or any key outside
 *              this set (a forged JSON payload smuggling e.g. `modelUrl` or
 *              `poseSource`) → REJECT before any SPARQL is built.
 *   MUTATION   a scoped SPARQL 1.1 DELETE/INSERT/WHERE — DELETE any existing
 *              (channel, predicate) triple, INSERT the new one, for each
 *              touched predicate ONLY, in the `:ux:control` graph ONLY, on
 *              the targeted channel subject ONLY. Nothing additive (unlike
 *              the `:ux:config` grow() cycle below), nothing outside that
 *              one subject, nothing outside the six allowed predicates.
 *
 * WHY NOT `apply-verb.ts`'s `VerbSpec`: that union is explicitly scoped to
 * ADDITIVE `:ux:config` grows (its own header calls a mutating, DELETE/INSERT
 * verb "a LABELED follow-on, not in this union"). This verb targets a
 * DIFFERENT graph (`:ux:control`, not `:ux:config`) with DIFFERENT semantics
 * (bounded replace, not additive-superset) — forcing it through `applyVerb`/
 * `validateConfig`/the additive-delta guard would be dishonest plumbing. It
 * is a SIBLING verb in the identical idiom (closed discriminated shape, gate
 * fully before any write, single choke point), not a member of that union.
 *
 * The gate + SPARQL-generation logic lives ONCE here, in the grow package —
 * mirroring grow.ts's own "one canonical path" principle — so no shell
 * (atelier / rhizome / organism / a future choreograph tool wrapper) ever
 * hand-rolls its own DELETE/INSERT string.
 *
 * Pure core (`applySetVtuberAppearance`): no DOM, no stores, no network,
 * config/overlay in, verdict out — exactly like `applyVerb`. The async cycle
 * (`growVtuberAppearance`) is the thin READ → gate → WRITE wrapper, parallel
 * to `grow()`, over an injected two-op port (the minimal honest mutation op
 * the design brief asks for: the cell already exposes `sparql_update`, so no
 * new cell-side capability is needed — only a new INJECTED port shape here).
 */

import {
  L,
  Ldec,
  termToNT,
  iriFor,
  NS,
  uxControlGraphIri,
  selectVtuberControlChannel,
  type Term,
  type VtuberControlChannel,
  type VtuberControlExpressionPreset,
  type VtuberControlOverlay,
} from '@shrubbery/nucleus'

/** sux: predicate IRI for a local term (matches the private helper in vtuber-control-rdf.ts). */
const sux = (local: string): string => NS.sux + local

/** 6-hex-digit `#RRGGBB` — the only tint format this verb admits (matches every tint example in the codebase, e.g. '#d6a84f'). */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * The only characters a `graphId` or channel local-id may contain to be safely
 * embedded as `<${NS.sux}${id}>` / `<${graphIri}>` inside the hand-built SPARQL
 * text below. SPARQL's IRIREF grammar forbids whitespace/control chars and the
 * six bytes < > " { } | ^ (plus backtick) inside `<...>` — anything outside
 * this allowlist could close the IRIREF early and splice extra clauses into
 * the generated DELETE/INSERT/WHERE (a GRAPH-clause breakout). Every real
 * graphId/channelId in this codebase is already a plain slug (`g-abc`,
 * `vtuber-main`, `agent-<hex>`), so this is not a new restriction in practice —
 * it is a structural gate against a graphId supplied by a hostile caller, or a
 * channel whose `sux:localId` was authored (via some other write path) with a
 * malicious value.
 */
const SAFE_IRI_TOKEN_RE = /^[A-Za-z0-9._~-]+$/

/**
 * Which of the four closed expression presets is valid, keyed as a `Record`
 * over `VtuberControlExpressionPreset` so a FUTURE change to that union in
 * vtuber-control-rdf.ts forces a compile error here instead of silently
 * drifting (no runtime import of a private array needed).
 */
const EXPRESSION_PRESET_SET: Record<VtuberControlExpressionPreset, true> = {
  neutral: true,
  focused: true,
  excited: true,
  strained: true,
}
function isKnownExpressionPreset(value: string): value is VtuberControlExpressionPreset {
  return Object.prototype.hasOwnProperty.call(EXPRESSION_PRESET_SET, value)
}

/** The closed field set this verb may touch — also the smuggle-guard allowlist. */
const ALLOWED_APPEARANCE_KEYS = [
  'expression',
  'accentTint',
  'eyeTint',
  'hairTint',
  'outfitTint',
  'skinWarmth',
] as const

// ── The verb ──────────────────────────────────────────────────────────────

/**
 * Where to find the channel to style: named directly, or resolved the same
 * way a rendered VTuber surface resolves its control channel
 * (`selectVtuberControlChannel` — panel binding wins over region binding).
 * Exactly one selector need be given; `channelId` takes priority if present.
 */
export interface VtuberAppearanceTarget {
  readonly channelId?: string
  readonly panelId?: string
  readonly regionId?: string
}

/** The closed styling surface — a non-empty subset of these six fields is required. */
export interface VtuberAppearanceEdit {
  readonly expression?: VtuberControlExpressionPreset
  readonly accentTint?: string
  readonly eyeTint?: string
  readonly hairTint?: string
  readonly outfitTint?: string
  readonly skinWarmth?: number
}

/** The closed, discriminated appearance verb — the security boundary BY SHAPE (same idiom as VerbSpec). */
export interface SetVtuberAppearanceSpec {
  readonly verb: 'set_vtuber_appearance'
  readonly target: VtuberAppearanceTarget
  readonly appearance: VtuberAppearanceEdit
}

/**
 * Which gate rejected: 'target' (channel did not resolve), 'fields' (styling
 * edit invalid), or 'scope' (graphId or the resolved channel's id is not a
 * safe IRI-local token — see `SAFE_IRI_TOKEN_RE`).
 */
export type SetAppearanceGate = 'target' | 'fields' | 'scope'

/** The result of the pure gate + generate step. */
export type SetAppearanceResult =
  | {
      readonly ok: true
      readonly channelId: string
      readonly channelIri: string
      /** The exact SPARQL 1.1 DELETE/INSERT/WHERE text to run via `sparql_update`. */
      readonly update: string
    }
  | { readonly ok: false; readonly gate: SetAppearanceGate; readonly error: string }

/**
 * Resolve `target` against the CURRENT control overlay. `channelId` wins if
 * given (the most explicit, unambiguous selector); otherwise falls back to
 * `selectVtuberControlChannel`'s panel-then-region resolution. An empty
 * string on any field is treated as absent (trimmed).
 */
function resolveTargetChannel(
  overlay: VtuberControlOverlay,
  target: VtuberAppearanceTarget,
): { ok: true; channel: VtuberControlChannel } | { ok: false; error: string } {
  // Defence in depth against a forged JSON payload that omits `target`
  // entirely (TypeScript's `VtuberAppearanceTarget` cannot be enforced at this
  // runtime boundary) — normalize to the empty selector so it falls through to
  // the ordinary "absent channel target" rejection below instead of throwing.
  const t = target ?? {}
  const channelId = t.channelId?.trim()
  if (channelId) {
    const channel = overlay.channels[channelId]
    if (!channel) {
      return {
        ok: false,
        error: `set_vtuber_appearance: unknown channel '${channelId}' — not present in :ux:control`,
      }
    }
    return { ok: true, channel }
  }

  const panelId = t.panelId?.trim()
  const regionId = t.regionId?.trim()
  if (panelId || regionId) {
    const channel = selectVtuberControlChannel(overlay, { panelId, regionId })
    if (!channel) {
      const via = panelId ? `panel '${panelId}'` : `region '${regionId}'`
      return { ok: false, error: `set_vtuber_appearance: no channel bound to ${via}` }
    }
    return { ok: true, channel }
  }

  return {
    ok: false,
    error: 'set_vtuber_appearance: absent channel target — one of channelId, panelId, or regionId is required',
  }
}

/**
 * Apply ONE `set_vtuber_appearance` verb against the CURRENT control overlay.
 *
 * Returns the SPARQL DELETE/INSERT/WHERE text to run ({ ok: true }) or a
 * rejection ({ ok: false }) with a human-readable reason. NOTHING is built on
 * a rejection — mirrors `applyVerb`'s "reject before construction" discipline.
 */
export function applySetVtuberAppearance(
  overlay: VtuberControlOverlay,
  graphId: string,
  spec: SetVtuberAppearanceSpec,
): SetAppearanceResult {
  const target = resolveTargetChannel(overlay, spec.target)
  if (!target.ok) return { ok: false, gate: 'target', error: target.error }

  // SCOPE GUARD — graphId (caller-supplied) and the resolved channel's id
  // (sourced from the control overlay's own `sux:localId` literal, not
  // necessarily authored by this verb) are both string-interpolated into
  // `<...>` IRIREFs by buildAppearanceUpdate below. Reject BEFORE any SPARQL
  // text is built if either is not a safe IRI-local token — see
  // `SAFE_IRI_TOKEN_RE` for why (GRAPH-clause breakout).
  if (!SAFE_IRI_TOKEN_RE.test(graphId)) {
    return {
      ok: false,
      gate: 'scope',
      error: `set_vtuber_appearance: graphId '${graphId}' is not a safe IRI-local token`,
    }
  }
  if (!SAFE_IRI_TOKEN_RE.test(target.channel.id)) {
    return {
      ok: false,
      gate: 'scope',
      error: `set_vtuber_appearance: channel id '${target.channel.id}' is not a safe IRI-local token`,
    }
  }

  // Defence in depth against a forged JS/JSON payload that omits `appearance`
  // entirely (TypeScript's `VtuberAppearanceEdit` cannot be enforced at this
  // runtime boundary) — normalize to the empty edit so it falls through to
  // the ordinary "empty appearance edit" rejection below instead of throwing.
  const appearance = spec.appearance ?? {}

  // Smuggle guard — defence in depth against a forged JS/JSON payload that
  // bypasses TypeScript and carries a key outside the closed field set (e.g.
  // 'modelUrl' or 'poseSource' — predicates this verb must never touch).
  const smuggled = Object.keys(appearance).filter(
    (k) => !(ALLOWED_APPEARANCE_KEYS as readonly string[]).includes(k),
  )
  if (smuggled.length > 0) {
    return {
      ok: false,
      gate: 'fields',
      error: `set_vtuber_appearance: unexpected field(s) in appearance edit: ${smuggled.join(', ')} — only ${ALLOWED_APPEARANCE_KEYS.join('/')} are allowed`,
    }
  }

  const fields: Array<{ predicate: string; object: Term }> = []

  if (appearance.expression !== undefined) {
    const value = appearance.expression
    if (!isKnownExpressionPreset(value)) {
      return {
        ok: false,
        gate: 'fields',
        error: `set_vtuber_appearance: expression '${value}' is not in the closed preset vocab (${Object.keys(EXPRESSION_PRESET_SET).join(', ')})`,
      }
    }
    fields.push({ predicate: sux('expression'), object: L(value) })
  }

  for (const key of ['accentTint', 'eyeTint', 'hairTint', 'outfitTint'] as const) {
    const value = appearance[key]
    if (value === undefined) continue
    if (!HEX_COLOR_RE.test(value)) {
      return {
        ok: false,
        gate: 'fields',
        error: `set_vtuber_appearance: malformed hex color for '${key}': '${value}' (expected #RRGGBB)`,
      }
    }
    fields.push({ predicate: sux(key), object: L(value) })
  }

  if (appearance.skinWarmth !== undefined) {
    const value = appearance.skinWarmth
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      return {
        ok: false,
        gate: 'fields',
        error: `set_vtuber_appearance: skinWarmth out of range: ${value} (must be in [0,1])`,
      }
    }
    fields.push({ predicate: sux('skinWarmth'), object: Ldec(value) })
  }

  if (fields.length === 0) {
    return {
      ok: false,
      gate: 'fields',
      error: `set_vtuber_appearance: empty appearance edit — at least one of ${ALLOWED_APPEARANCE_KEYS.join('/')} is required`,
    }
  }

  const channelIri = iriFor(target.channel.id)
  const graphIri = uxControlGraphIri(graphId)
  const update = buildAppearanceUpdate(channelIri, graphIri, fields)

  return { ok: true, channelId: target.channel.id, channelIri, update }
}

/**
 * Build the scoped SPARQL 1.1 DELETE/INSERT/WHERE: DELETE any existing
 * (channelIri, predicate) triple in `graphIri` for each touched predicate,
 * INSERT the new one, `OPTIONAL`-guarded so a predicate absent on the channel
 * today does not fail the delete. Subject is `channelIri` in every clause,
 * predicates are only ever the caller-selected subset of `fields` (which
 * `applySetVtuberAppearance` has already restricted to the six allowed
 * `sux:` names) — the bounded-mutation shape is structural, not filtered
 * after the fact.
 */
function buildAppearanceUpdate(
  channelIri: string,
  graphIri: string,
  fields: ReadonlyArray<{ predicate: string; object: Term }>,
): string {
  const del = fields.map((f, i) => `    <${channelIri}> <${f.predicate}> ?v${i} .`).join('\n')
  const ins = fields.map((f) => `    <${channelIri}> <${f.predicate}> ${termToNT(f.object)} .`).join('\n')
  const where = fields
    .map((f, i) => `  OPTIONAL { GRAPH <${graphIri}> { <${channelIri}> <${f.predicate}> ?v${i} } }`)
    .join('\n')
  return [
    'DELETE {',
    `  GRAPH <${graphIri}> {`,
    del,
    '  }',
    '}',
    'INSERT {',
    `  GRAPH <${graphIri}> {`,
    ins,
    '  }',
    '}',
    'WHERE {',
    where,
    '}',
  ].join('\n')
}

// ── The host-side cycle (parallel to grow()) ────────────────────────────────

/**
 * The narrow cell port `growVtuberAppearance` needs — the minimal honest
 * mutation op the design brief calls for. The cell already exposes
 * `sparql_update`; only the INJECTED port shape is new here (no cell-side
 * change), same DI discipline as `GrowCell` in grow.ts.
 */
export interface AppearanceGrowCell {
  /** Read + parse the cell's `:ux:control` overlay (parallels GrowCell.readConfig). */
  readControlOverlay(graphId: string): Promise<VtuberControlOverlay>
  /**
   * Run a scoped SPARQL DELETE/INSERT mutation (non-additive) against the
   * cell. The shell wires this to
   * `contract.mcp.toolsCall('sparql_update', sparqlUpdateArgs(graphId, update))`.
   */
  mutateGraph(graphId: string, update: string): Promise<void>
}

/**
 * Run one `set_vtuber_appearance` cycle: READ the control overlay, gate +
 * generate (pure, see `applySetVtuberAppearance`), WRITE via `sparql_update`
 * on a gate pass. On a rejection, `mutateGraph` is NEVER called — the same
 * "nothing written unless the gate passes" discipline as `grow()`.
 */
export async function growVtuberAppearance(
  port: AppearanceGrowCell,
  graphId: string,
  spec: SetVtuberAppearanceSpec,
): Promise<SetAppearanceResult> {
  const overlay = await port.readControlOverlay(graphId)
  const gated = applySetVtuberAppearance(overlay, graphId, spec)
  if (!gated.ok) return gated
  await port.mutateGraph(graphId, gated.update)
  return gated
}

/**
 * The exact `sparql_update` tool-call arg shape (the copy-paste-prone bit —
 * parallels `rdfLoadArgs` in grow-cell.ts). `graphId` selects the cell's
 * store; the named-graph targeting lives INSIDE `update`'s `GRAPH <iri> {…}`
 * clauses (unlike `rdf_load`, `sparql_update` takes no separate
 * `targetGraphIri` — see the harness's `sparql_update` inputSchema).
 */
export function sparqlUpdateArgs(graphId: string, update: string): { graphId: string; update: string } {
  return { graphId, update }
}

/**
 * Assemble an `AppearanceGrowCell` from the two injected cell operations
 * (parallels `makeGrowCell` in grow-cell.ts).
 */
export function makeAppearanceGrowCell(ops: {
  readControlOverlay: (graphId: string) => Promise<VtuberControlOverlay>
  mutateGraph: (graphId: string, update: string) => Promise<void>
}): AppearanceGrowCell {
  return { readControlOverlay: ops.readControlOverlay, mutateGraph: ops.mutateGraph }
}
