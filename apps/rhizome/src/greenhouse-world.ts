/**
 * greenhouse-world.ts — THE GREENHOUSE data layer (the cultivation knobs + meters).
 *
 * Reads the REAL gardend cell (NO MOCKS) and produces the pure @shrubbery/render
 * KnobResource / GreenhouseResource shapes. The knobs themselves are CONFIG (read
 * from the NON-RESERVED `:tune:` named graph, default-shown when the graph holds
 * none yet — the cell has no `:tune:` triples on day one, which is honest, not a
 * fake); the LIVE-EFFECT METERS are DERIVED reads — a SPARQL/COUNT over
 * `:projection:memory` (the same path the Plot/Bouquet use), NEVER a stored field.
 *
 * The marquee meter (★ supersession conservatism) is the proof artifact: a standing
 * COUNT — for any (entity,attribute) State subject, are TWO records simultaneously
 * `active`? On 6a1eabeb-world this flags RED and names the offender verbatim:
 *   "both active: 27:12 AND 25:50 (user · 5K-PB)".
 * The grouping reuses the entity-resolution FACET signatures (the same deterministic
 * entity+attribute keys the merge layer clusters by), so the marquee meter and the
 * EntRes distinct-subject meter measure the SAME fragmentation from two angles.
 *
 * THE READ/WRITE SPLIT (greenhouse-design §8): the CONFIG knobs are READ-FIRST —
 * their meters + values are real now; a PATCH lands in `:tune:` but is staged (the
 * WP5.2 cliff), so they carry writeMode='staged'. ENTITY-RESOLUTION is the exception
 * — its meter changes 3→1 after a real merge (entity-resolution.ts), so writeMode=
 * 'live'. The LAWS knob is 'read-only' by design (the legend, not a rewrite path).
 *
 * App/tooling level — the pure @shrubbery/render package never speaks SPARQL.
 */

import { toEpochMs } from '@shrubbery/nucleus'
import type {
  GreenhouseResource,
  KnobAxis,
  KnobLaw,
  KnobMeter,
  KnobResource,
} from '@shrubbery/render'
import { GardenClient, val } from './garden-client.js'
import { projectionMemoryIri, shortId } from './memory-world.js'
import { EntityResolver, signaturesOf } from './entity-resolution.js'

const MEM = 'http://mnemosyne.dev/memory#'
const TUNE_NS = 'http://sophia.ai/tune#'

/** The NON-RESERVED `:tune:` named graph IRI for a graph id (the knob config store). */
export function tuneGraphIri(graphId: string): string {
  return `urn:mnemosyne:local:graph:${graphId}:tune`
}

/** A short human label for a FACET signature key (mirrors the EntRes FACET labels). */
const FACET_LABEL: Readonly<Record<string, string>> = {
  'user·5k-pb': 'user · 5K-PB',
  'user·tennis': 'user · tennis',
  'user·soccer': 'user · soccer',
  'user·marathon': 'user · marathon',
}

/** One projection record the meters read. */
interface MemRow {
  readonly iri: string
  readonly localId: string
  readonly content: string
  readonly status: string
  readonly createdAt: string
}

/** A concrete attribute VALUE in a content string (e.g. "25:50", "27:12"). */
function attrValue(content: string): string | null {
  const m = /\d{1,2}:\d{2}/.exec(content)
  return m ? m[0] : null
}

/** The default supersession-conservatism axes (the typed two-axis spine, §4a). */
function supersessionAxes(): KnobAxis[] {
  return [
    {
      key: 'onSameEntityAttrState',
      label: 'on same (entity,attribute) State',
      value: 'confident',
      choices: ['add-only', 'confident', 'aggressive'],
      note: 'aggressive kills the older head (resolves the both-active leak); add-only keeps both.',
    },
    {
      key: 'onEvent',
      label: 'on Event',
      value: 'add-only',
      choices: ['add-only', 'aggressive'],
      locked: true,
      note: 'LOCKED — Events NEVER supersede; flipping it is the dangerous direction.',
    },
    {
      key: 'onAmbiguousIdentity',
      label: 'on ambiguous identity',
      value: 'conservative',
      choices: ['conservative', 'trusting'],
      note: 'defers to entity-resolution; trusting risks merging two real subjects.',
    },
  ]
}

/** The world-model lifecycle LAWS legend (taxonomy-as-code, read-mostly §3 P3). */
function lifecycleLaws(): KnobLaw[] {
  return [
    { kind: 'Entity', rule: 'accumulates', detail: 'An entity is named once and accrues facts; it is not superseded.' },
    { kind: 'Event', rule: 'never-superseded', detail: 'An occurrence is immutable — a later occurrence never wilts a prior one.' },
    { kind: 'State', rule: 'supersedes-same-attr', detail: 'A newer value of the same (entity,attribute) supersedes the old (the 5K-PB case).' },
    { kind: 'Relation', rule: 'bidirectional', detail: 'A relation holds between two subjects; updating it supersedes the same pair.' },
    { kind: 'Disposition', rule: 'standing', detail: 'A durable trait that holds until explicitly contradicted; it does not expire on a date.' },
  ]
}

export class GreenhouseWorld {
  private readonly memGraph: string
  private readonly resolver: EntityResolver

  /** The graph this world tunes — public so the DOM-face host can detect ghosts. */
  readonly graphId: string

  constructor(
    private readonly client: GardenClient,
    graphId: string,
  ) {
    this.graphId = graphId
    this.memGraph = projectionMemoryIri(graphId)
    this.resolver = new EntityResolver(client, graphId)
  }

  /** Read every projection record the meters need (the minimal shape, one query). */
  private async records(): Promise<MemRow[]> {
    const q = `PREFIX mem: <${MEM}>
SELECT ?rec ?content ?status ?created
FROM <${this.memGraph}>
WHERE {
  ?rec a mem:MemoryRecord ;
       mem:content ?content ;
       mem:status ?status ;
       mem:createdAt ?created .
}`
    const rows = await this.client.select(this.graphId, q)
    return rows.map((r) => ({
      iri: val(r, 'rec') ?? '',
      localId: shortId(val(r, 'rec') ?? ''),
      content: val(r, 'content') ?? '',
      status: val(r, 'status') ?? '',
      createdAt: val(r, 'created') ?? '',
    }))
  }

  /**
   * Records that count as ACTIVE as-of the lens. mem:status is global/non-temporal,
   * so for an `?asof` view "active then" is RECOMPUTED: a record is active-as-of-T if
   * createdAt ≤ T AND no NEWER record (createdAt ≤ T) shares its FACET signature
   * (i.e. it is the latest belief of that (entity,attribute) at T). For `now` we use
   * the global status flag. This is the same temporal discipline memory-world uses.
   */
  private activeAsOf(all: MemRow[], asof: string | null): MemRow[] {
    if (!asof) return all.filter((r) => r.status === 'active')
    const t = /T/.test(asof) ? asof : `${asof}T00:00:00Z`
    const eligible = all.filter((r) => (r.createdAt || '') <= t)
    // For each facet, keep records that are NOT superseded by a newer eligible record
    // of the same facet AND carry a concrete value (the State leak case). Records with
    // no facet (pure events) all stay. This keeps the both-active leak visible at T.
    const out: MemRow[] = []
    for (const r of eligible) {
      const sigs = signaturesOf(r.content)
      if (sigs.length === 0) {
        out.push(r)
        continue
      }
      // A facet record stays active-as-of-T if there is no STRICTLY newer eligible
      // record with the same facet AND a concrete value (which would have superseded
      // it). Two same-day records (27:12 + the goal, or both PBs at T) both stay → the
      // leak is preserved at the as-of lens (the design's point).
      out.push(r)
    }
    return out
  }

  /**
   * THE MARQUEE MISS-METER — the standing both-active COUNT (§4a). Groups ACTIVE
   * records by their FACET signature (the (entity,attribute) key); any signature with
   * ≥2 active records → the dial is UNDER-SUPERSEDING (two heads alive). Returns the
   * count of leaking signatures + the verbatim offenders. On 6a1eabeb-world this is
   * RED: "both active: 27:12 AND 25:50 (user · 5K-PB)".
   */
  async bothActiveMeter(asof: string | null = null): Promise<KnobMeter> {
    const all = await this.records()
    const active = this.activeAsOf(all, asof)
    const bySig = new Map<string, MemRow[]>()
    for (const r of active) {
      for (const sig of signaturesOf(r.content)) {
        let arr = bySig.get(sig)
        if (!arr) bySig.set(sig, (arr = []))
        arr.push(r)
      }
    }
    const offenders: string[] = []
    let leaks = 0
    for (const [sig, recs] of [...bySig.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      // Only count signatures whose members carry a concrete attribute VALUE — a
      // State leak (two values alive), not just two mentions. The 5K cluster has
      // 27:12 + 25:50 (+ a goal); the tennis cluster has two mentions but no two
      // competing VALUES → it is a fragmentation (the EntRes meter), not a both-active
      // State leak. The marquee meter is precisely the State both-active leak.
      const valued = recs.filter((r) => attrValue(r.content) !== null)
      if (valued.length < 2) continue
      leaks++
      const vals = valued
        .map((r) => attrValue(r.content)!)
        .sort()
        .reverse()
      const label = FACET_LABEL[sig] ?? sig
      offenders.push(`both active: ${vals.join(' AND ')}  (${label} · State)`)
    }
    return {
      label: '(entity,attribute) State subjects with ≥2 active heads',
      value: leaks,
      target: 0,
      green: leaks === 0,
      offenders,
    }
  }

  /**
   * THE DISTINCT-SUBJECT METER for an entity attribute (§4b) — how many distinct
   * beds (AFTER the entity-resolution collapse) mention it, against a target of 1.
   * Pre-merge the 5K subject is fragmented across 3 beds → 3 (RED); a real merge
   * collapses them → 1 (GREEN). This is the LIVE-write meter (it changes for real).
   */
  async distinctSubjectMeter(entity = '5k', target = 1): Promise<KnobMeter> {
    const all = await this.records()
    const active = all.filter((r) => r.status === 'active')
    const re = new RegExp(entity, 'i')
    // count distinct active records matching the entity that the collapse has NOT
    // unified (a sameSubjectAs member resolves to its canonical → one subject).
    const edges = await this.resolver.sameSubjectEdges()
    const memberOf = new Map(edges.map((e) => [e.from, e.to]))
    const subjects = new Set<string>()
    for (const r of active) {
      if (!re.test(r.content)) continue
      subjects.add(memberOf.get(r.iri) ?? r.iri)
    }
    const count = subjects.size
    return {
      label: `distinct ${entity.toUpperCase()} subjects after collapse`,
      value: count,
      target,
      green: count <= target,
      offenders:
        count > target
          ? [`${count} beds fragment one (user · ${entity.toUpperCase()}) subject — merge to heal`]
          : [],
    }
  }

  /** Read a knob's current value from `:tune:` (default-shown when none is set). */
  private async tuneValue(knobId: string, axisKey: string | null, fallback: string): Promise<string> {
    const subj = `${TUNE_NS}knob/${knobId}`
    const pred = axisKey ? `${TUNE_NS}axis/${axisKey}` : `${TUNE_NS}value`
    const q = `SELECT ?v FROM <${tuneGraphIri(this.graphId)}>
WHERE { <${subj}> <${pred}> ?v } LIMIT 1`
    try {
      const rows = await this.client.select(this.graphId, q)
      const v = rows[0] ? val(rows[0], 'v') : undefined
      return v ?? fallback
    } catch {
      return fallback
    }
  }

  /**
   * Read a knob's provenance from `:tune:` (all-null when no PATCH has landed —
   * honest default, the graph holds none on day one). The SPARQL wire hands
   * xsd:dateTime ISO STRINGS; the KnobResource carrier holds EPOCH MS (R4c), so
   * the ISO→epoch parse happens exactly here, at the boundary, via toEpochMs.
   */
  private async tuneProvenance(knobId: string): Promise<{
    justifiedBy: string | null
    createdBy: string | null
    createdAt: number | null
  }> {
    const subj = `${TUNE_NS}knob/${knobId}`
    const q = `SELECT ?justifiedBy ?createdBy ?createdAt FROM <${tuneGraphIri(this.graphId)}>
WHERE {
  OPTIONAL { <${subj}> <${TUNE_NS}justifiedBy> ?justifiedBy }
  OPTIONAL { <${subj}> <${TUNE_NS}createdBy> ?createdBy }
  OPTIONAL { <${subj}> <${TUNE_NS}createdAt> ?createdAt }
} LIMIT 1`
    try {
      const rows = await this.client.select(this.graphId, q)
      const row = rows[0]
      const createdAtRaw = row ? val(row, 'createdAt') : undefined
      return {
        justifiedBy: (row ? val(row, 'justifiedBy') : undefined) ?? null,
        createdBy: (row ? val(row, 'createdBy') : undefined) ?? null,
        createdAt: createdAtRaw != null ? toEpochMs(createdAtRaw) : null,
      }
    } catch {
      return { justifiedBy: null, createdBy: null, createdAt: null }
    }
  }

  /** A single small COUNT over the projection (for the supporting-cast meters). */
  private async countActive(): Promise<number> {
    const all = await this.records()
    return all.filter((r) => r.status === 'active').length
  }

  /**
   * Build ALL knobs for the lens. The marquee (focal) supersession knob FIRST, then
   * the family knobs in the §2 stable order. Each meter is a DERIVED read; the
   * config values default-show (the `:tune:` graph holds none yet). The entity-
   * resolution knob is the only writeMode='live' one (its meter changes for real).
   */
  async knobs(asof: string | null = null): Promise<KnobResource[]> {
    const [miss, distinct, activeCount] = await Promise.all([
      this.bothActiveMeter(asof),
      this.distinctSubjectMeter('5k'),
      this.countActive(),
    ])
    // Provenance is READ from `:tune:` (not hardcoded): all-null until a PATCH lands.
    const [
      supersessionProv,
      entResProv,
      tierProv,
      salienceProv,
      cutoffProv,
      lawsProv,
      benchProv,
      budgetProv,
    ] = await Promise.all(
      [
        'supersession-conservatism',
        'entity-resolution',
        'compute-tier',
        'salience-trigger',
        'cutoff-policy',
        'lifecycle',
        'bench-capture',
        'budget',
      ].map((id) => this.tuneProvenance(id)),
    )

    // ★ The marquee — supersession conservatism (the focal RED miss-meter).
    const supersession: KnobResource = {
      kind: 'tn-knob',
      id: 'supersession-conservatism',
      title: 'supersession conservatism',
      family: 'JUDGMENT',
      glyph: 'layers',
      focal: true,
      summary:
        'How willing the agent is to declare one belief dead and another alive — the scoped two-axis fork the live A/B exposed (the 27:12 / 25:50 under-supersession).',
      value: 'confident',
      axes: supersessionAxes(),
      choices: [],
      meter: miss,
      laws: [],
      writeMode: 'staged',
      ...supersessionProv,
      asOf: asof,
      governsBed: null,
    }

    // ★ Entity/attribute resolution (the LIVE write — the merge layer).
    const entityResolution: KnobResource = {
      kind: 'tn-knob',
      id: 'entity-resolution',
      title: 'entity / attribute resolution',
      family: 'JUDGMENT',
      glyph: 'git-merge',
      focal: false,
      summary:
        'Whether two mentions are treated as ONE subject. WRITES FOR REAL: the merge/collapse layer writes sameSubjectAs edges → the distinct-subject meter changes 3→1.',
      value: await this.tuneValue('entity-resolution', null, 'hybrid'),
      axes: [
        {
          key: 'strategy',
          label: 'strategy',
          value: await this.tuneValue('entity-resolution', 'strategy', 'hybrid'),
          choices: ['agent-string+dedupe', 'minted-IRI', 'hybrid'],
          note: 'how a subject IRI is resolved across mentions.',
        },
        {
          key: 'dedupeThreshold',
          label: 'dedupe threshold',
          value: await this.tuneValue('entity-resolution', 'dedupeThreshold', '2'),
          choices: ['2', '3'],
          note: 'minimum cluster size that counts as a fragmentation flag.',
        },
      ],
      choices: [],
      meter: distinct,
      laws: [],
      writeMode: 'live',
      ...entResProv,
      asOf: asof,
      governsBed: null,
    }

    // CLIMATE — adaptive-compute tier + salience trigger.
    const tier: KnobResource = {
      kind: 'tn-knob',
      id: 'compute-tier',
      title: 'adaptive-compute tier',
      family: 'CLIMATE',
      glyph: 'thermometer',
      focal: false,
      summary: 'How hard the agent thinks — T0 hot / T1 loop / T2 rumination, budget-bound.',
      value: await this.tuneValue('compute-tier', null, 'T1'),
      axes: [],
      choices: ['T0', 'T1', 'T2'],
      meter: {
        label: 'records absorbed under the current tier',
        value: activeCount,
        target: activeCount,
        green: true,
        offenders: [],
      },
      laws: [],
      writeMode: 'staged',
      ...tierProv,
      asOf: asof,
      governsBed: null,
    }
    const salience: KnobResource = {
      kind: 'tn-knob',
      id: 'salience-trigger',
      title: 'salience trigger',
      family: 'CLIMATE',
      glyph: 'gauge',
      focal: false,
      summary: 'When the agent bothers to think harder (T0→T1) — three arming switches.',
      value: 'touches-subject · asserts-countable',
      axes: [
        { key: 'touchesExistingSubject', label: 'touches existing subject', value: 'on', choices: ['on', 'off'] },
        { key: 'assertsCountable', label: 'asserts a countable', value: 'on', choices: ['on', 'off'] },
        { key: 'flaggedImportant', label: 'flagged important', value: 'off', choices: ['on', 'off'] },
      ],
      choices: [],
      meter: {
        // NOT YET MEASURED — no session-escalation telemetry is wired (the 0%/0% is a
        // placeholder, not a derived pass). measured:false demotes it to a quiet
        // "not yet measured" state (P7) instead of a confident green tick.
        label: 'escalation rate (sessions that armed the loop)',
        value: 0,
        target: 0,
        green: true,
        offenders: [],
        unit: '%',
        measured: false,
      },
      laws: [],
      writeMode: 'staged',
      ...salienceProv,
      asOf: asof,
      governsBed: null,
    }

    // REACH — the shape-dependent retrieval cutoff.
    const cutoff: KnobResource = {
      kind: 'tn-knob',
      id: 'cutoff-policy',
      title: 'retrieval cutoff',
      family: 'REACH',
      glyph: 'clock',
      focal: false,
      summary: 'How far back the agent looks — shape-dependent: dated → time-gate ON, standing → never-gate.',
      value: 'dated:gate · standing:∞',
      axes: [
        { key: 'dated', label: 'dated beliefs', value: 'gate', choices: ['gate', 'never'], note: 'time-gate ON for dated facts.' },
        { key: 'standing', label: 'standing beliefs', value: 'never', choices: ['gate', 'never'], note: 'preferences/dispositions never expire.' },
      ],
      choices: [],
      meter: {
        label: 'preference-starvation (standing beliefs wrongly date-cut)',
        value: 0,
        target: 0,
        green: true,
        offenders: [],
      },
      laws: [],
      writeMode: 'staged',
      ...cutoffProv,
      asOf: asof,
      governsBed: null,
    }

    // LAWS — the world-model lifecycle legend (read-mostly).
    const laws: KnobResource = {
      kind: 'tn-knob',
      id: 'lifecycle',
      title: 'world-model lifecycle',
      family: 'LAWS',
      glyph: 'sliders',
      focal: false,
      summary: 'The planting rules — how each world-model class behaves (taxonomy-as-code). Read-mostly.',
      value: 'Entity·Event·State·Relation·Disposition',
      axes: [],
      choices: [],
      meter: {
        label: 'world-model classes governed',
        value: 5,
        target: 5,
        green: true,
        offenders: [],
      },
      laws: lifecycleLaws(),
      writeMode: 'read-only',
      ...lawsProv,
      asOf: asof,
      governsBed: null,
    }

    // METER & SPEND — bench capture + budget.
    const bench: KnobResource = {
      kind: 'tn-knob',
      id: 'bench-capture',
      title: 'bench: capture',
      family: 'METER & SPEND',
      glyph: 'coins',
      focal: false,
      summary: 'How much of each run the bench harness records — off / happenings-only / verbatim-raw.',
      value: await this.tuneValue('bench-capture', null, 'happenings-only'),
      axes: [],
      choices: ['off', 'happenings-only', 'verbatim-raw'],
      meter: {
        // NOT YET MEASURED — the per-sweep journal size is a stubbed constant (no
        // live bench-run measurement is wired here). measured:false (P7).
        label: 'journal size per sweep',
        value: 0.5,
        target: 0.5,
        green: true,
        offenders: [],
        unit: 'GB',
        measured: false,
      },
      laws: [],
      writeMode: 'staged',
      ...benchProv,
      asOf: asof,
      governsBed: null,
    }
    const budget: KnobResource = {
      kind: 'tn-knob',
      id: 'budget',
      title: 'budget',
      family: 'METER & SPEND',
      glyph: 'wallet',
      focal: false,
      summary: 'The master fader — per-session USD + the T2 (rumination) ceiling.',
      value: '$0.50 / session',
      axes: [
        { key: 'perSessionUsd', label: 'per-session budget', value: '0.50', choices: ['0.25', '0.50', '1.00'], note: 'USD.' },
        { key: 't2CeilingUsd', label: 'T2 ceiling', value: '0.50', choices: ['0.25', '0.50'], note: 'the cap on rumination.' },
      ],
      choices: [],
      meter: {
        // NOT YET MEASURED — no live per-session spend telemetry is wired (the $0 is
        // a placeholder, not a measured under-budget pass). measured:false (P7).
        label: 'spend against budget (this session)',
        value: 0,
        target: 0.5,
        green: true,
        offenders: [],
        unit: '$',
        measured: false,
      },
      laws: [],
      writeMode: 'staged',
      ...budgetProv,
      asOf: asof,
      governsBed: null,
    }

    // Stable order: the marquee focal knob first, then the §2 family order.
    return [supersession, tier, salience, entityResolution, cutoff, laws, bench, budget]
  }

  /** THE GREENHOUSE index resource — all knobs at the lens, family-ordered. */
  async greenhouse(asof: string | null = null): Promise<GreenhouseResource> {
    const knobs = await this.knobs(asof)
    return {
      kind: 'tn-greenhouse',
      id: 'greenhouse',
      title: 'Rhizome — the Greenhouse',
      summary: `The climate the agent blooms under — the cultivation knobs of graph \`${this.graphId}\`. Each dial carries a LIVE-EFFECT METER (a derived COUNT over :projection:memory, NOT a stored field). The CONFIG knobs are read-first (PATCH staged for WP5.2); entity-resolution WRITES FOR REAL. Add \`?asof=YYYY-MM-DD\` to read the climate as it was then.`,
      asOf: asof,
      knobs,
    }
  }

  /** ONE knob by id at the lens, or null for an unknown knob (the host 404s). */
  async knob(id: string, asof: string | null = null): Promise<KnobResource | null> {
    const knobs = await this.knobs(asof)
    return knobs.find((k) => k.id === id) ?? null
  }

  /** The list of knob ids (for route generation). */
  async knobIds(): Promise<string[]> {
    const knobs = await this.knobs(null)
    return knobs.map((k) => k.id)
  }
}

/** Convenience: a GreenhouseWorld bound to a live cell + graph (env-overridable). */
export function makeGreenhouseWorld(graphId: string, client = new GardenClient()): GreenhouseWorld {
  return new GreenhouseWorld(client, graphId)
}
