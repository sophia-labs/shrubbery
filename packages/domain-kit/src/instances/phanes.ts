import {
  buildDomainAgentSeedBundle,
  type DomainAgentBundleInput,
  type DomainAgentSeedBundle,
  mintStandaloneAgentId,
} from '../agent-bundle.js'
import { buildDomainToolbeltGrant } from '../grant.js'
import { buildDomainInstanceSeed, type DomainInstanceSeed } from '../instance.js'
import { buildDomainTriggerConsent, domainTriggerConsentDigest } from '../trigger-consent.js'
import type { DomainCapabilityManifest } from '../types.js'
import {
  DOMAIN_AGENT_RESPONSE_SCHEMA,
  DOMAIN_SEED_EPOCH,
  GRAPH_READER_TOOLS,
  PLATFORM_STEWARD,
  standardDomainQueries,
} from './shared.js'

export const PHANES_REGISTERED_NAME = 'phanes'
export const PHANES_GRAPH_ID = 'phanes'

export const PHANES_MANIFEST: DomainCapabilityManifest = {
  schemaVersion: 1,
  programId: 'phanes-domain-v1',
  title: 'Phanes Discord domain capability claims',
  tiers: {
    T0: 'Static contract and graph projection',
    T1: 'Local listener and sandbox proof',
    T2: 'Consented cloud listener with host-executed effects',
  },
  modes: ['contract', 'local', 'cloud-2-canary'],
  roles: ['community-member', 'community-steward', 'agent'],
  verdicts: ['PASS', 'FAIL', 'BLOCKED'],
  capabilities: [
    {
      id: 'PHANES-C001',
      domain: 'phanes',
      title: 'Ingest consented Discord history into canonical KG identities',
      tier: 'T1',
      modes: ['local', 'cloud-2-canary'],
      roles: ['community-steward'],
      journeys: ['PHANES-J001'],
      stateful: true,
    },
    {
      id: 'PHANES-C002',
      domain: 'phanes',
      title: 'Admit a mention or opted-in listener event through a source fence',
      tier: 'T2',
      modes: ['cloud-2-canary'],
      roles: ['community-member', 'community-steward'],
      journeys: ['PHANES-J002'],
      stateful: true,
    },
    {
      id: 'PHANES-C003',
      domain: 'phanes',
      title: 'Ground Discord questions through ontology-aware graph retrieval',
      tier: 'T1',
      modes: ['local', 'cloud-2-canary'],
      roles: ['community-member', 'community-steward', 'agent'],
      journeys: ['PHANES-J002'],
      stateful: false,
    },
    {
      id: 'PHANES-C004',
      domain: 'phanes',
      title: 'Delegate bounded retrieval to disposable depth-1 emanations',
      tier: 'T1',
      modes: ['local', 'cloud-2-canary'],
      roles: ['agent'],
      journeys: ['PHANES-J002'],
      stateful: false,
    },
    {
      id: 'PHANES-C005',
      domain: 'phanes',
      title: 'Post a reply or media effect through the credential-owning Discord edge',
      tier: 'T2',
      modes: ['cloud-2-canary'],
      roles: ['agent'],
      journeys: ['PHANES-J003'],
      stateful: true,
    },
  ],
  journeys: [
    {
      id: 'PHANES-J001',
      order: 1,
      title: 'Ingest a bounded Discord history fixture',
      tier: 'T1',
      capabilities: ['PHANES-C001'],
      modes: ['local', 'cloud-2-canary'],
      roles: ['community-steward'],
      steps: [
        {
          id: 'ingest',
          action: 'Fetch an allowlisted history window and write canonical message/member/channel nodes through the graph API.',
          expected: 'Stable Discord IDs are idempotent and the import is isolated to the phanes graph.',
          evidence: ['source-window-digest', 'graph-dump', 'ingest-receipt'],
        },
      ],
    },
    {
      id: 'PHANES-J002',
      order: 2,
      title: 'Answer a grounded mention with optional emanations',
      tier: 'T2',
      capabilities: ['PHANES-C002', 'PHANES-C003', 'PHANES-C004'],
      modes: ['cloud-2-canary'],
      roles: ['community-member', 'agent'],
      steps: [
        {
          id: 'attend',
          action: 'Admit one consented mention, resolve its bounded context, and run one disposable Domain Agent wave.',
          expected: 'The pilot returns grounded testimony and no sandbox survives the wave.',
          evidence: ['trigger-receipt', 'run-sse', 'query-testimony', 'process-liveness'],
        },
      ],
    },
    {
      id: 'PHANES-J003',
      order: 3,
      title: 'Execute a reply proposal at the Discord edge',
      tier: 'T2',
      capabilities: ['PHANES-C005'],
      modes: ['cloud-2-canary'],
      roles: ['agent'],
      steps: [
        {
          id: 'reply',
          action: 'Validate the proposal against the active grant and triggering message fence, then post exactly once.',
          expected: 'The host-fixed Discord reply and effect receipt converge on the durable source-turn identity.',
          evidence: ['effect-receipt', 'discord-message-ref', 'idempotency-replay'],
        },
      ],
    },
  ],
}

export const PHANES_CHARTER = `# Phanes charter

Phanes is a domain colleague for consented Discord communities, not a resident chatbot process.

For every eligible mention, opted-in ambient event, or voice utterance, attend freely to the request and its bounded channel context. Ground claims in the Phanes graph, prefer stable Discord IDs, and use the Discord ontology and sealed query catalogue before inventing raw joins. Preserve the legacy Phanes virtues: concise and slightly laconic speech, visible progress for long investigations, chart or artifact output when it clarifies the answer, and small delegated retrieval sweeps when one central pass would wander.

The pilot retains final judgment. Emanations investigate only narrow independent questions and cannot delegate, write, or reply. Access to history is not consent to repeat private material. Use only the source scope admitted by the listener; minimize quotation and distinguish graph evidence from interpretation.

Every world change is a typed proposal. A reply proposal is not permission to post it. The durable Discord edge owns the bot token, listener reachability, source consent, rate limits, attachments, typing/progress messages, and effect execution. It may execute only a current grant operation within the triggering guild/channel/message fence. Durable memory and KG enrichment target only the phanes graph. No agent process survives the wave.`

export const PHANES_PROMPT = `You are Phanes. You can see a great deal of a community's recorded discourse; treat that weightily without becoming solemn or chipper.

Start with the user's actual question. Resolve ambiguous guilds, channels, members, and messages to stable IDs. Prefer curated graph queries for ordinary retrieval, use raw SPARQL only for an uncovered aggregate, and delegate only genuinely broad independent retrieval. Do not delegate the final answer.

Read the admitted source-event reference from the Phanes graph before answering; the serialized trigger is a fence, not the message context. Answer concisely in Discord-sized prose. For an admitted Discord turn, put the final answer in response.discord.replyText and propose exactly one discord message.reply effect whose arguments contain only that same text. Treat effectId and idempotencyKey as opaque audit labels: the durable host owns the target and derives execution identity from the committed source turn plus effect ordinal. Never claim a reply, graph update, reaction, transcription, or voice playback happened until its host receipt says so.`

export function buildPhanesAgentBundle(input: {
  readonly promotedAt?: number
  readonly promotedBy?: string
} = {}): DomainAgentSeedBundle {
  return buildDomainAgentSeedBundle(phanesAgentInput(input))
}

export function buildPhanesDomainInstance(input: {
  readonly promotedAt?: number
  readonly promotedBy?: string
} = {}): DomainInstanceSeed {
  const promotedAt = input.promotedAt ?? DOMAIN_SEED_EPOCH
  return buildDomainInstanceSeed({
    domain: 'phanes',
    graphId: PHANES_GRAPH_ID,
    manifest: PHANES_MANIFEST,
    queries: standardDomainQueries('phanes'),
    dashboard: {
      layoutId: 'phanes-domain-dashboard-v1',
      surfaceIri: 'urn:sophia:ux:surface:phanes-domain',
      stats: [
        { id: 'claim-counts', label: 'Declared claims', queryName: 'urn:sophia:query:phanes.claims.summary', format: 'number' },
        { id: 'coverage', label: 'Verdict coverage', queryName: 'urn:sophia:query:phanes.verdicts.coverage', format: 'percent' },
        { id: 'freshness', label: 'Last evidenced', queryName: 'urn:sophia:query:phanes.freshness', format: 'dateTimeRelative' },
      ],
      verdictsQueryName: 'urn:sophia:query:phanes.verdicts.current',
      freshnessQueryName: 'urn:sophia:query:phanes.freshness',
      generatedAt: new Date(promotedAt).toISOString(),
      maxAgeSeconds: 86_400,
    },
    agent: phanesAgentInput(input),
  })
}

function phanesAgentInput(input: {
  readonly promotedAt?: number
  readonly promotedBy?: string
}): DomainAgentBundleInput {
  const promotedAt = input.promotedAt ?? DOMAIN_SEED_EPOCH
  const promotedBy = input.promotedBy ?? PLATFORM_STEWARD
  const agentId = mintStandaloneAgentId(PHANES_REGISTERED_NAME)
  const discordConsent = buildDomainTriggerConsent({
    consentId: 'consent-phanes-discord',
    subjectAgentId: agentId,
    issuedBy: promotedBy,
    authorityGraphId: 'observatory',
    adapter: 'discord',
    triggerKinds: ['discord.message.mention', 'discord.message.ambient', 'discord.voice.utterance'],
    sourcePrefixes: ['discord:guild:'],
    issuedAt: promotedAt,
    status: 'active',
    maxContextRefs: 64,
    maxContextBytes: 1_048_576,
    retention: 'graph-referenced',
    sourceRefs: ['urn:sophia:review:trigger-consent:phanes-discord'],
  })
  const grant = buildDomainToolbeltGrant({
    grantId: 'grant-phanes',
    subjectAgentId: agentId,
    issuedBy: promotedBy,
    authorityGraphId: 'observatory',
    issuedAt: promotedAt,
    status: 'active',
    capabilities: [
      {
        capability: 'mnemosyne',
        operations: ['recall', 'search_documents', 'sparql_query', 'write_document', 'sparql_update', 'remember'],
        access: 'write',
        approvalPolicy: 'ordinary',
        operationPolicies: { remember: 'notify' },
        fence: { graphIds: [PHANES_GRAPH_ID], maxPayloadBytes: 262_144 },
        quota: { maxPerWave: 16, maxPerDay: 2_000 },
      },
      {
        capability: 'domain.verdict',
        operations: ['write'],
        access: 'write',
        approvalPolicy: 'ordinary',
        fence: {
          graphIds: [PHANES_GRAPH_ID],
          resourcePrefixes: ['domain:phanes:'],
          maxPayloadBytes: 262_144,
        },
        quota: { maxPerWave: 8, maxPerDay: 1_000 },
      },
      {
        capability: 'discord',
        operations: ['message.reply', 'message.edit', 'message.react', 'voice.play'],
        access: 'write',
        approvalPolicy: 'ordinary',
        operationPolicies: { 'voice.play': 'notify' },
        // The listener supplies this durable source resource. Sandbox output
        // may not mint a synthetic "trigger" namespace to choose its target.
        fence: { resourcePrefixes: ['discord:guild:'], maxPayloadBytes: 8_388_608 },
        quota: { maxPerWave: 8, maxPerDay: 1_000, maxConcurrent: 4 },
      },
      {
        capability: 'audio',
        operations: ['transcribe', 'synthesize'],
        access: 'write',
        approvalPolicy: 'ordinary',
        operationPolicies: { synthesize: 'notify' },
        fence: { resourcePrefixes: ['discord:guild:'], maxPayloadBytes: 26_214_400 },
        quota: { maxPerWave: 4, maxPerDay: 200, maxCostMicrousd: 250_000 },
      },
      {
        capability: 'workflow',
        operations: ['loom_run'],
        access: 'read',
        approvalPolicy: 'ordinary',
        fence: { resourcePrefixes: ['domain-agent:phanes:emanation:'] },
        quota: { maxPerWave: 3, maxConcurrent: 3, maxCostMicrousd: 500_000 },
      },
    ],
    sourceRefs: [
      'urn:sophia:review:domain-agent-grant:phanes',
      'urn:sophia:precedent:legacy-phanes-agent-loop',
    ],
  })
  return {
    registeredName: PHANES_REGISTERED_NAME,
    homeGraphId: PHANES_GRAPH_ID,
    agentRef: 'urn:sophia:domain-agent:phanes',
    ontologyRefs: [
      'urn:sophia:ontology:agent:v2',
      'urn:sophia:domain-kit:v1',
      'urn:sophia:ontology:phanes-discord:v1',
    ],
    charter: PHANES_CHARTER,
    prompt: PHANES_PROMPT,
    promotedBy,
    promotedAt,
    grant,
    directTools: GRAPH_READER_TOOLS,
    triggers: [
      phanesDiscordTrigger('discord.message.mention', 'reply-to-trigger', discordConsent, 32),
      phanesDiscordTrigger('discord.message.ambient', 'consented-listener', discordConsent, 32),
      phanesDiscordTrigger('discord.voice.utterance', 'consented-listener', discordConsent, 16),
      {
        kind: 'phanes.manual.request',
        enabled: true,
        mode: 'authenticated-owner',
        ingress: 'owner',
        sourceFence: { resourcePrefixes: ['graph:phanes:'], eventIdRequired: true, maxContextRefs: 64 },
      },
    ],
    triggerConsents: { 'consent-phanes-discord': discordConsent },
    responseSchema: {
      ...DOMAIN_AGENT_RESPONSE_SCHEMA,
      required: ['summary', 'status', 'evidenceRefs', 'discord'],
      properties: {
        ...DOMAIN_AGENT_RESPONSE_SCHEMA.properties,
        discord: {
          type: 'object',
          additionalProperties: false,
          required: ['replyText'],
          properties: {
            replyText: { type: 'string', maxLength: 12_000 },
            attachmentRefs: { type: 'array', items: { type: 'string' }, maxItems: 10 },
          },
        },
      },
    },
    models: { pilot: 'thinkingmachines/inkling', emanation: 'thinkingmachines/inkling-small' },
    budgets: { pilotMaxTurns: 16, emanationMaxTurns: 6, maxEmanations: 3, maxProposedEffects: 12 },
  }
}

function phanesDiscordTrigger(
  kind: string,
  mode: string,
  consent: ReturnType<typeof buildDomainTriggerConsent>,
  maxContextRefs: number,
) {
  return {
    kind,
    enabled: true,
    mode,
    ingress: 'internal-service' as const,
    adapter: 'discord',
    consentRef: {
      graphId: consent.authorityGraphId,
      documentId: 'consent-phanes-discord',
      expectedDigest: domainTriggerConsentDigest(consent),
    },
    sourceFence: { resourcePrefixes: ['discord:guild:'], eventIdRequired: true, maxContextRefs },
  }
}
