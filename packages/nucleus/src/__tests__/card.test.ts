import { describe, expect, it } from 'vitest'

import {
  agentMark,
  buildAgentCard,
  buildConstitutionStrip,
  compactDuration,
  deriveBindingLineage,
  hashAgentId,
  shortAgentId,
  summarizeIncidents,
} from '../kinds/card.js'

/**
 * The world-doc shape here is the LIVE learner-1 world (agent-132c2f7244ec645b),
 * captured from the running stack — real testimony used as literal input, not a
 * transport mock. The pure projection is exercised against exactly the JSON the
 * gardend cell serves.
 */
const LEARNER_WORLD = {
  agent: {
    agentId: 'agent-132c2f7244ec645b',
    handle: 'learner-1',
    agentType: 'learner-1',
    kindLine: 'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
    graphId: 'vehicle-local',
  },
  status: {
    lifecycle: 'completed',
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
  },
  prompts: {
    system: {
      id: 'system',
      title: 'Learner 1 System Prompt',
      text: 'You are learner-1 , an agent in the Sophia system.',
      digest: '420f2c09dcc06a83b24720f6ae59a0a42a9c5d2d4e75a01e330060d6ebb21f3a',
      source: { externalId: 'agent-prompt-learner-1-system' },
      updatedAt: 1783294312286,
      document: { documentId: 'agent-prompt-learner-1-system', snapshotId: 'aps_45b3dbcfcd9990bb', dirty: false },
      binding: { documentId: 'agent-prompt-learner-1-system', activeFrom: 1783125247176, status: 'active' },
    },
  },
  toolbelt: {
    tools: [
      { name: 'recall', available: true, required: true, state: 'used' },
      { name: 'remember', available: true, required: true, state: 'used' },
      { name: 'search_documents', available: true, required: true, state: 'used' },
    ],
  },
}

describe('agentMark — deterministic botanical identity', () => {
  it('is stable across calls for the same id', () => {
    const first = agentMark('agent-132c2f7244ec645b')
    const second = agentMark('agent-132c2f7244ec645b')
    expect(first).toEqual(second)
  })

  it('yields a botanical hex, a name, and one of the three arrangements', () => {
    const mark = agentMark('agent-132c2f7244ec645b')
    expect(mark.color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(mark.colorName.length).toBeGreaterThan(0)
    expect(['spray', 'cluster', 'sprig']).toContain(mark.arrangement)
  })

  it('distinguishes different ids (hash spreads across the palette)', () => {
    const names = new Set(
      ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5', 'harmonizer-abc'].map((id) => agentMark(id).colorName),
    )
    expect(names.size).toBeGreaterThan(1)
  })

  it('hashAgentId never returns a negative or NaN', () => {
    for (const id of ['', 'a', 'agent-132c2f7244ec645b', 'x'.repeat(64)]) {
      const hash = hashAgentId(id)
      expect(Number.isInteger(hash)).toBe(true)
      expect(hash).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('shortAgentId', () => {
  it('elides a long id to head…tail', () => {
    expect(shortAgentId('agent-132c2f7244ec645b')).toBe('agent-132c2f…45b')
  })
  it('leaves a short id whole', () => {
    expect(shortAgentId('learner-1')).toBe('learner-1')
  })
})

describe('compactDuration', () => {
  it('renders honest compact units', () => {
    expect(compactDuration(30 * 1000)).toBe('1m')
    expect(compactDuration(3 * 60 * 60 * 1000)).toBe('3h')
    expect(compactDuration(2 * 24 * 60 * 60 * 1000)).toBe('2d')
    expect(compactDuration(21 * 24 * 60 * 60 * 1000)).toBe('3w')
  })
})

describe('buildAgentCard — live learner-1 world', () => {
  const card = buildAgentCard({
    agentId: 'agent-132c2f7244ec645b',
    handle: 'learner-1',
    agentType: 'learner-1',
    graphId: 'vehicle-local',
    kindLine: 'A named Sophia-standard learner agent with dynamic Mnemosyne tools.',
    lifecycle: 'completed',
    sessionCount: 32,
    worldDoc: LEARNER_WORLD,
  })

  it('reads identity, sub-plate, and kindLine from testimony', () => {
    expect(card.identity).toBe('learner-1')
    expect(card.sub).toBe('learner-1 · agent-132c2f…45b · vehicle-local')
    expect(card.kindLine).toBe('A named Sophia-standard learner agent with dynamic Mnemosyne tools.')
    expect(card.tone).toBe('dormant') // completed → honest rest
    expect(card.lifecycleWord).toBe('completed')
  })

  it('carries a deterministic mark', () => {
    expect(card.mark).toEqual(agentMark('agent-132c2f7244ec645b'))
  })

  it('reads the model value without inventing attribution', () => {
    expect(card.model).not.toBeNull()
    expect(card.model?.value).toBe('deepseek-v4-pro')
    // status.attribution.model is absent → nothing witnessed the value; no "set by".
    expect(card.model?.observer).toBeNull()
  })

  it('reads the charter from prompts.system — clean, promoted, with the real digest', () => {
    expect(card.charter.dirty).toBe(false)
    expect(card.charter.bindingName).toBe('agent-prompt-learner-1-system')
    expect(card.charter.promotedAt).toBe(1783125247176)
    expect(card.charter.title).toBe('Learner 1 System Prompt')
    expect(card.charter.digest).toBe('420f2c09dcc06a83b24720f6ae59a0a42a9c5d2d4e75a01e330060d6ebb21f3a')
    expect(card.charter.snapshotId).toBe('aps_45b3dbcfcd9990bb')
    expect(card.charter.text).toContain('learner-1')
    expect(card.charter.hasStandingOrders).toBe(false)
    // No `compatibilitySeeded` served (a healthy graph read) → false, never a guess.
    expect(card.charter.seeded).toBe(false)
  })

  it('reads the loadout from the toolbelt — 3 of 3 mounted, none hung', () => {
    expect(card.loadout.mounted).toEqual(['recall', 'remember', 'search_documents'])
    expect(card.loadout.available).toBe(3)
    expect(card.loadout.total).toBe(3)
    expect(card.loadout.hung).toEqual([])
  })

  it('serves conversations but marks every unbuilt rollup as awaiting (never a guess)', () => {
    expect(card.conversations).toBe(32)
    expect(card.awaits).toEqual({
      ward: true,
      careerTurns: true,
      careerTokens: true,
      incidents: true,
      bindingHistory: true,
      careerMemories: true,
      age: true,
    })
  })

  it('un-chips career turns/tokens the moment the roster serves them, and never before', () => {
    const served = buildAgentCard({ agentId: 'learner-1', careerTurns: 158, careerTokens: 498160 })
    expect(served.careerTurns).toBe(158)
    expect(served.careerTokens).toBe(498160)
    expect(served.awaits.careerTurns).toBe(false)
    expect(served.awaits.careerTokens).toBe(false)

    const unserved = buildAgentCard({ agentId: 'learner-1' })
    expect(unserved.careerTurns).toBeNull()
    expect(unserved.careerTokens).toBeNull()
    expect(unserved.awaits.careerTurns).toBe(true)
    expect(unserved.awaits.careerTokens).toBe(true)
    // Lifetime memories and age have no served source anywhere yet — always chipped.
    expect(unserved.awaits.careerMemories).toBe(true)
    expect(unserved.awaits.age).toBe(true)
  })
})

describe('buildAgentCard — a required tool that is missing hangs the loadout', () => {
  const card = buildAgentCard({
    agentId: 'agent-x',
    lifecycle: 'paused',
    worldDoc: {
      status: { model: 'sonnet-5', attribution: { model: { value: 'sonnet-5', actorId: 'vera', eventSeq: 42 } } },
      prompts: { system: { document: { dirty: true } } },
      toolbelt: {
        tools: [
          { name: 'recall', available: true, required: true },
          { name: 'surface', available: true, required: true },
          { name: 'graph_write', available: false, required: true },
        ],
      },
    },
  })

  it('names the hung store and keeps the mounted count honest', () => {
    expect(card.loadout.available).toBe(2)
    expect(card.loadout.total).toBe(3)
    expect(card.loadout.hung).toEqual(['graph_write'])
  })

  it('renders model attribution when a real actor witnessed the change', () => {
    expect(card.model?.value).toBe('sonnet-5')
    expect(card.model?.observer).toBe('vera')
    expect(card.model?.eventSeq).toBe(42)
  })

  it('marks the charter dirty (an unpromoted edit)', () => {
    expect(card.charter.dirty).toBe(true)
  })
})

/**
 * Phosphor honesty: choreograph serves `document.compatibilitySeeded: true` at the
 * exact field path `worldDoc.prompts.system.document.compatibilitySeeded` whenever
 * the agent's model/charter fell back to hardcoded in-code constants because the
 * graph read failed (`promptArtifactFromProfile` in choreograph's agent-world.ts,
 * `document.compatibilitySeeded: profile.compatibilitySeededPrompt ?? false`). A
 * fallback identity must never render pixel-identical to graph-read truth.
 */
describe('buildAgentCard — a compatibility-seeded charter (the graph read failed)', () => {
  const seededCard = buildAgentCard({
    agentId: 'agent-x',
    worldDoc: {
      status: { model: 'deepseek-v4-pro' },
      prompts: { system: { document: { dirty: false, compatibilitySeeded: true } } },
    },
  })

  it('marks the charter seeded — a fallback identity, not testimony from the graph', () => {
    expect(seededCard.charter.seeded).toBe(true)
  })

  it('seeded and dirty are independent — a seeded charter is not automatically dirty', () => {
    expect(seededCard.charter.dirty).toBe(false)
  })

  it('an absent flag on an otherwise-identical doc reads seeded=false, never undefined', () => {
    const healthyCard = buildAgentCard({
      agentId: 'agent-x',
      worldDoc: {
        status: { model: 'deepseek-v4-pro' },
        prompts: { system: { document: { dirty: false } } },
      },
    })
    expect(healthyCard.charter.seeded).toBe(false)
  })
})

/**
 * The live prompt-binding chain for learner-1 (agent-132c2f7244ec645b), captured from
 * `GET /api/agents/learner-1/prompt-bindings` — real testimony as literal input. Note
 * the newest row (apb_5891…) is a same-snapshot re-promotion blip that started AFTER
 * the active binding and was retired 422ms later; it must NOT count as a predecessor.
 */
const LEARNER_BINDINGS = [
  { bindingId: 'apb_5891d4f329e5200b', status: 'superseded', snapshotId: 'aps_45b3dbcfcd9990bb', activeFrom: 1783283849675, activeUntil: 1783283850097 },
  { bindingId: 'apb_6777c10011c10f38', status: 'active', snapshotId: 'aps_45b3dbcfcd9990bb', activeFrom: 1783125247176, activeUntil: null },
  { bindingId: 'apb_2c5742bfe609f1e8', status: 'superseded', snapshotId: 'aps_f6b098467501503d', activeFrom: 1783124754378, activeUntil: 1783125247176 },
  { bindingId: 'apb_0f890fcf8b1701d1', status: 'superseded', snapshotId: 'aps_6f45da9109ac4837', activeFrom: 1782871039041, activeUntil: 1783124754378 },
  { bindingId: 'apb_6fc1878078620d0c', status: 'superseded', snapshotId: 'aps_e6f090b530b2184b', activeFrom: 1782852317216, activeUntil: 1782871039041 },
]

/** The live incident list shape for learner-1 (`GET /api/agents/learner-1/incidents`). */
const LEARNER_INCIDENTS = [
  { ts: 1783296630045, sessionId: 'ags_8df669a08ba851840098', kind: 'conversation.turn.tool.failed', detail: { toolName: 'search_documents' } },
  { ts: 1783296104062, sessionId: 'ags_ef530fc75904744a976c', kind: 'conversation.turn.tool.failed' },
  { ts: 1783295000000, sessionId: 'ags_older', kind: 'conversation.turn.terminal' },
]

const LEARNER_ENVELOPE = {
  schema: 'sophia.agent-operating-envelope.v0',
  wards: { turnBudget: { maxTurns: 8, source: 'agent-session.source.maxTurns' } },
  gatedTools: { includeTools: ['recall', 'search_documents', 'remember'], source: 'agent-session.source.tool-gates' },
}

describe('summarizeIncidents — K3, served / served-empty / unserved', () => {
  it('summarizes a served list newest-first with count + latest, bounded', () => {
    const summary = summarizeIncidents(LEARNER_INCIDENTS)
    expect(summary).not.toBeNull()
    expect(summary?.count).toBe(3)
    expect(summary?.latest).toEqual({ ts: 1783296630045, kind: 'conversation.turn.tool.failed', sessionId: 'ags_8df669a08ba851840098' })
    expect(summary?.recent.map((incident) => incident.ts)).toEqual([1783296630045, 1783296104062, 1783295000000])
  })

  it('sorts newest-first even when the transport hands them out of order', () => {
    const summary = summarizeIncidents([LEARNER_INCIDENTS[2], LEARNER_INCIDENTS[0], LEARNER_INCIDENTS[1]])
    expect(summary?.latest?.ts).toBe(1783296630045)
  })

  it('drops rows with no ts or no kind (silence, never a fabricated incident)', () => {
    const summary = summarizeIncidents([...LEARNER_INCIDENTS, { ts: 0, kind: '' }, { kind: 'x' }])
    expect(summary?.count).toBe(3)
  })

  it('a served-but-empty list is a real zero summary, not null', () => {
    const summary = summarizeIncidents([])
    expect(summary).toEqual({ count: 0, latest: null, recent: [] })
  })

  it('an unfetched list is null (the ° chip stays)', () => {
    expect(summarizeIncidents(null)).toBeNull()
    expect(summarizeIncidents(undefined)).toBeNull()
  })
})

describe('deriveBindingLineage — K2, the formerly line', () => {
  it('names the binding retired when the current one took over, ignoring a later blip', () => {
    const lineage = deriveBindingLineage(LEARNER_BINDINGS)
    expect(lineage.hasPrior).toBe(true)
    expect(lineage.formerlyId).toBe(shortAgentId('apb_2c5742bfe609f1e8'))
    // The prior's activeUntil === the active binding's activeFrom — its retired date.
    expect(lineage.retiredAt).toBe(1783125247176)
  })

  it('has no prior when the served history holds a single binding', () => {
    const lineage = deriveBindingLineage([{ bindingId: 'apb_only', status: 'active', activeFrom: 100, activeUntil: null }])
    expect(lineage).toEqual({ formerlyId: null, retiredAt: null, hasPrior: false })
  })

  it('has no prior when the chain is unfetched', () => {
    expect(deriveBindingLineage(null).hasPrior).toBe(false)
    expect(deriveBindingLineage(undefined).hasPrior).toBe(false)
    expect(deriveBindingLineage([]).hasPrior).toBe(false)
  })
})

describe('buildAgentCard — the envelope ward (K4), served / absent', () => {
  it('reads the ward turn budget and gated tools from worldDoc.envelope', () => {
    const card = buildAgentCard({ agentId: 'learner-1', worldDoc: { ...LEARNER_WORLD, envelope: LEARNER_ENVELOPE } })
    expect(card.ward.maxTurns).toBe(8)
    expect(card.ward.gatedTools).toEqual(['recall', 'search_documents', 'remember'])
    expect(card.awaits.ward).toBe(false)
  })

  it('keeps the ° chip when the envelope region is absent (older backend)', () => {
    const card = buildAgentCard({ agentId: 'learner-1', worldDoc: LEARNER_WORLD })
    expect(card.ward.maxTurns).toBeNull()
    expect(card.ward.gatedTools).toEqual([])
    expect(card.awaits.ward).toBe(true)
  })

  it('keeps the ° chip when the region is present but the turn budget is not', () => {
    const card = buildAgentCard({ agentId: 'learner-1', worldDoc: { envelope: { gatedTools: { includeTools: ['recall'] } } } })
    expect(card.ward.maxTurns).toBeNull()
    expect(card.ward.gatedTools).toEqual(['recall'])
    expect(card.awaits.ward).toBe(true)
  })
})

describe('buildAgentCard — incidents, binding history, and roster rollups un-chip when served', () => {
  it('un-chips incidents and binding history and carries the lineage when served', () => {
    const card = buildAgentCard({
      agentId: 'agent-132c2f7244ec645b',
      handle: 'learner-1',
      worldDoc: LEARNER_WORLD,
      incidents: LEARNER_INCIDENTS,
      bindings: LEARNER_BINDINGS,
    })
    expect(card.incidents?.count).toBe(3)
    expect(card.awaits.incidents).toBe(false)
    expect(card.lineage.hasPrior).toBe(true)
    expect(card.lineage.formerlyId).toBe(shortAgentId('apb_2c5742bfe609f1e8'))
    expect(card.awaits.bindingHistory).toBe(false)
  })

  it('keeps the ° chips when neither list is fetched', () => {
    const card = buildAgentCard({ agentId: 'learner-1', worldDoc: LEARNER_WORLD })
    expect(card.incidents).toBeNull()
    expect(card.awaits.incidents).toBe(true)
    expect(card.lineage.hasPrior).toBe(false)
    expect(card.awaits.bindingHistory).toBe(true)
  })

  it('un-chips memories and age when the roster serves them, and chips otherwise', () => {
    const served = buildAgentCard({ agentId: 'learner-1', careerMemories: 41, firstSessionAt: 1782852317216 })
    expect(served.careerMemories).toBe(41)
    expect(served.firstSessionAt).toBe(1782852317216)
    expect(served.awaits.careerMemories).toBe(false)
    expect(served.awaits.age).toBe(false)

    const unserved = buildAgentCard({ agentId: 'learner-1' })
    expect(unserved.careerMemories).toBeNull()
    expect(unserved.firstSessionAt).toBeNull()
    expect(unserved.awaits.careerMemories).toBe(true)
    expect(unserved.awaits.age).toBe(true)
  })
})

describe('buildConstitutionStrip — the bay re-sentenced', () => {
  const now = 1783294695298
  const cleanCard = buildAgentCard({
    agentId: 'agent-132c2f7244ec645b',
    handle: 'learner-1',
    lifecycle: 'resident',
    sessionCount: 32,
    worldDoc: LEARNER_WORLD,
  })

  it('speaks binding stability, prompt state, and loadout health — no drift when clean', () => {
    const strip = buildConstitutionStrip({ id: 'agent-132c2f7244ec645b', identity: 'learner-1', card: cleanCard, now })
    expect(strip.stateSentence).toBe('binding stable 2d · prompt clean · loadout 3/3')
    expect(strip.drift).toEqual([])
    expect(strip.testimony).toEqual({ text: 'deepseek-v4-pro', attribution: null })
    expect(strip.attested).toBe(true)
  })

  it('drops the binding clause and raises drift when the prompt is edited-not-promoted and a store hangs', () => {
    const driftedCard = buildAgentCard({
      agentId: 'harmonizer-1',
      lifecycle: 'paused',
      worldDoc: {
        prompts: { system: { document: { dirty: true } } },
        toolbelt: {
          tools: [
            { name: 'recall', available: true, required: true },
            { name: 'surface', available: true, required: true },
            { name: 'graph_write', available: false, required: true },
          ],
        },
      },
    })
    const strip = buildConstitutionStrip({ id: 'harmonizer-1', identity: 'harmonizer-1', card: driftedCard, now })
    expect(strip.stateSentence).toBe('prompt edited, not promoted · loadout 2/3 — graph_write hung')
    expect(strip.drift).toEqual(['drift ×2'])
    expect(strip.tone).toBe('held')
  })

  it('renders an honest reduced sentence when no card is held (the bay holds one live world)', () => {
    const strip = buildConstitutionStrip({ id: 'shrubbery-2', identity: 'shrubbery-2', card: null, lifecycle: 'dormant', now })
    expect(strip.stateSentence).toBe('constitution unread — hook to read its charter')
    expect(strip.drift).toEqual([])
    expect(strip.attested).toBe(false)
    expect(strip.tone).toBe('dormant')
  })
})
