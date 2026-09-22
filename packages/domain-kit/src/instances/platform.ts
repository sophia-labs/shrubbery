import { mintStandaloneAgentId } from '../agent-bundle.js'
import { buildDomainToolbeltGrant } from '../grant.js'
import { buildDomainInstanceSeed, type DomainInstanceSeed } from '../instance.js'
import { buildDomainTriggerConsent, domainTriggerConsentDigest } from '../trigger-consent.js'
import type { DomainCapabilityManifest } from '../types.js'
import { DOMAIN_AGENT_RESPONSE_SCHEMA, DOMAIN_SEED_EPOCH, GRAPH_READER_TOOLS, PLATFORM_STEWARD, standardDomainQueries } from './shared.js'

export const PLATFORM_DOMAIN = 'platform'
export const PLATFORM_GRAPH_ID = 'observatory'
export const PLATFORM_AGENT_NAME = 'platform-1'

export const PLATFORM_MANIFEST: DomainCapabilityManifest = {
  schemaVersion: 1,
  programId: 'sophia-platform-domain-v1',
  title: 'Sophia Platform Domain capability claims',
  tiers: {
    T0: 'Static contract and deterministic projection',
    T1: 'Local or isolated runtime proof',
    T2: 'Cloud-2 canary proof with durable testimony',
  },
  modes: ['contract', 'local', 'cloud-2-canary'],
  roles: ['platform-steward', 'domain-owner', 'agent'],
  verdicts: ['PASS', 'FAIL', 'BLOCKED'],
  capabilities: [
    {
      id: 'PLAT-C001',
      domain: PLATFORM_DOMAIN,
      title: 'Provision a graph-backed domain instance from Domain Kit contracts',
      tier: 'T1',
      modes: ['local', 'cloud-2-canary'],
      roles: ['platform-steward'],
      journeys: ['PLAT-J001'],
      stateful: true,
    },
    {
      id: 'PLAT-C002',
      domain: PLATFORM_DOMAIN,
      title: 'Resolve and run a graph-defined Domain Agent as a bounded disposable wave',
      tier: 'T2',
      modes: ['cloud-2-canary'],
      roles: ['platform-steward', 'domain-owner', 'agent'],
      journeys: ['PLAT-J002'],
      stateful: true,
    },
    {
      id: 'PLAT-C003',
      domain: PLATFORM_DOMAIN,
      title: 'Issue, reconcile, suspend, and revoke fenced toolbelt grants',
      tier: 'T1',
      modes: ['contract', 'cloud-2-canary'],
      roles: ['platform-steward'],
      journeys: ['PLAT-J003'],
      stateful: true,
    },
    {
      id: 'PLAT-C004',
      domain: PLATFORM_DOMAIN,
      title: 'Project bounded runtime testimony into Observatory without content leakage',
      tier: 'T2',
      modes: ['cloud-2-canary'],
      roles: ['platform-steward', 'domain-owner'],
      journeys: ['PLAT-J002'],
      stateful: true,
    },
  ],
  journeys: [
    {
      id: 'PLAT-J001',
      order: 1,
      title: 'Materialize and serve a second domain',
      tier: 'T1',
      capabilities: ['PLAT-C001'],
      modes: ['local', 'cloud-2-canary'],
      roles: ['platform-steward'],
      steps: [
        {
          id: 'seed',
          action: 'Apply manifest, catalogue, dashboard, agent documents, and authority grant through public graph contracts.',
          expected: 'The graph projection matches the source digest and has exactly one layout literal.',
          evidence: ['graph-dump', 'manifest-digest', 'route-response'],
        },
      ],
    },
    {
      id: 'PLAT-J002',
      order: 2,
      title: 'Run a disposable platform-agent wave',
      tier: 'T2',
      capabilities: ['PLAT-C002', 'PLAT-C004'],
      modes: ['cloud-2-canary'],
      roles: ['platform-steward', 'domain-owner', 'agent'],
      steps: [
        {
          id: 'invoke',
          action: 'Trigger the graph-defined agent, observe its run stream, and wait for all sandboxes to terminate.',
          expected: 'One bounded run and testimony remain; no agent process remains.',
          evidence: ['run-sse', 'process-liveness', 'observatory-testimony', 'effect-receipts'],
        },
      ],
    },
    {
      id: 'PLAT-J003',
      order: 3,
      title: 'Prove grant authority is monotone and revocable',
      tier: 'T1',
      capabilities: ['PLAT-C003'],
      modes: ['contract', 'cloud-2-canary'],
      roles: ['platform-steward'],
      steps: [
        {
          id: 'reconcile',
          action: 'Request an undeclared or out-of-fence operation, then suspend the grant and retry.',
          expected: 'Both attempts fail closed at the host edge and emit refusal testimony.',
          evidence: ['grant-digest', 'refusal-receipt', 'observatory-testimony'],
        },
      ],
    },
  ],
}

export const PLATFORM_CHARTER = `# platform-1 charter

Keep the cloud development platform honest about the capabilities it offers domain owners. Watch contract, gate, deployment, billing, and activation-ledger freshness. Run the smallest smoke journey that can establish or overturn a platform claim. Record scoped evidence-bearing verdicts and surface uncertainty rather than painting the dashboard green.

This agent is a colleague of the platform steward, not the source of Layer 0 authority. It may inspect grants and propose routine fenced operations; only the steward trust root issues or changes grants. Build, GitHub, deployment, public routing, and destructive effects remain behind their explicit operation policy. Every invocation is a disposable wave and every effect crosses the durable host edge.`

export const PLATFORM_PROMPT = `You are platform-1. Read the platform manifest, activation ledger, recent gate verdicts, deployment testimony, grants, and prior memory. Select one stale or consequential claim and test it narrowly. Use deterministic checks before model judgment. Return evidence references and proposed effects; never confuse a proposal, a queued deployment, or a passing unit test with a witnessed cloud-2 outcome.`

export function buildPlatformDomainInstance(
  input: { readonly promotedAt?: number; readonly promotedBy?: string } = {},
): DomainInstanceSeed {
  const promotedAt = input.promotedAt ?? DOMAIN_SEED_EPOCH
  const promotedBy = input.promotedBy ?? PLATFORM_STEWARD
  const agentId = mintStandaloneAgentId(PLATFORM_AGENT_NAME)
  const automationConsent = buildDomainTriggerConsent({
    consentId: 'consent-platform-1-automation',
    subjectAgentId: agentId,
    issuedBy: promotedBy,
    authorityGraphId: PLATFORM_GRAPH_ID,
    adapter: 'platform-scheduler',
    triggerKinds: ['platform.ledger.stale', 'platform.deployment.changed'],
    sourcePrefixes: ['observatory:ledger:', 'cloud-2:canary:deployment:'],
    issuedAt: promotedAt,
    status: 'active',
    maxContextRefs: 256,
    maxContextBytes: 1_048_576,
    retention: 'graph-referenced',
    sourceRefs: ['urn:sophia:review:trigger-consent:platform-1-automation'],
  })
  const grant = buildDomainToolbeltGrant({
    grantId: 'grant-platform-1',
    subjectAgentId: agentId,
    issuedBy: promotedBy,
    authorityGraphId: PLATFORM_GRAPH_ID,
    issuedAt: promotedAt,
    status: 'active',
    capabilities: [
      {
        capability: 'mnemosyne',
        operations: ['recall', 'search_documents', 'sparql_query', 'write_document', 'sparql_update', 'remember'],
        access: 'write',
        approvalPolicy: 'ordinary',
        operationPolicies: { remember: 'notify' },
        fence: { graphIds: [PLATFORM_GRAPH_ID], maxPayloadBytes: 1_048_576 },
        quota: { maxPerWave: 32, maxPerDay: 2_000 },
      },
      {
        capability: 'domain.verdict',
        operations: ['write'],
        access: 'write',
        approvalPolicy: 'ordinary',
        fence: {
          graphIds: [PLATFORM_GRAPH_ID],
          resourcePrefixes: [`domain:${PLATFORM_DOMAIN}:`],
          maxPayloadBytes: 262_144,
        },
        quota: { maxPerWave: 8, maxPerDay: 1_000 },
      },
      {
        capability: 'workflow',
        operations: ['loom_run'],
        access: 'read',
        approvalPolicy: 'ordinary',
        fence: { resourcePrefixes: ['platform:smoke:'] },
        quota: { maxPerWave: 4, maxConcurrent: 4, maxCostMicrousd: 1_000_000 },
      },
      {
        capability: 'deployment',
        operations: ['plan', 'canary.rollout', 'canary.rollback'],
        access: 'write',
        approvalPolicy: 'notify',
        operationPolicies: { 'canary.rollback': 'human-always' },
        fence: { resourcePrefixes: ['cloud-2:canary:'] },
        quota: { maxPerWave: 2, maxConcurrent: 1, maxCostMicrousd: 5_000_000 },
      },
      {
        capability: 'grant-admin',
        operations: ['grant.inspect', 'grant.propose'],
        access: 'write',
        approvalPolicy: 'human-always',
        fence: { graphIds: [PLATFORM_GRAPH_ID], resourcePrefixes: ['grant-'] },
        quota: { maxPerWave: 4 },
      },
    ],
    sourceRefs: ['urn:sophia:review:domain-agent-grant:platform-1'],
  })
  return buildDomainInstanceSeed({
    domain: PLATFORM_DOMAIN,
    graphId: PLATFORM_GRAPH_ID,
    manifest: PLATFORM_MANIFEST,
    queries: standardDomainQueries(PLATFORM_DOMAIN),
    dashboard: {
      layoutId: 'platform-domain-dashboard-v1',
      surfaceIri: 'urn:sophia:ux:surface:platform-domain',
      stats: [
        { id: 'claim-counts', label: 'Declared claims', queryName: 'urn:sophia:query:platform.claims.summary', format: 'number' },
        { id: 'coverage', label: 'Verdict coverage', queryName: 'urn:sophia:query:platform.verdicts.coverage', format: 'percent' },
        { id: 'freshness', label: 'Last evidenced', queryName: 'urn:sophia:query:platform.freshness', format: 'dateTimeRelative' },
      ],
      verdictsQueryName: 'urn:sophia:query:platform.verdicts.current',
      freshnessQueryName: 'urn:sophia:query:platform.freshness',
      generatedAt: new Date(promotedAt).toISOString(),
      maxAgeSeconds: 3_600,
    },
    agent: {
      registeredName: PLATFORM_AGENT_NAME,
      homeGraphId: PLATFORM_GRAPH_ID,
      agentRef: 'urn:sophia:domain-agent:platform-1',
      ontologyRefs: ['urn:sophia:ontology:agent:v2', 'urn:sophia:domain-kit:v1', 'urn:sophia:domain:platform:v1'],
      charter: PLATFORM_CHARTER,
      prompt: PLATFORM_PROMPT,
      promotedBy,
      promotedAt,
      grant,
      directTools: GRAPH_READER_TOOLS,
      triggers: [
        platformAutomationTrigger('platform.ledger.stale', 'scheduled', 'observatory:ledger:', automationConsent),
        {
          kind: 'platform.smoke.requested',
          enabled: true,
          mode: 'human-request',
          ingress: 'owner',
          sourceFence: { resourcePrefixes: ['graph:observatory:'], eventIdRequired: true, maxContextRefs: 256 },
        },
        platformAutomationTrigger(
          'platform.deployment.changed',
          'event',
          'cloud-2:canary:deployment:',
          automationConsent,
        ),
      ],
      triggerConsents: { 'consent-platform-1-automation': automationConsent },
      responseSchema: DOMAIN_AGENT_RESPONSE_SCHEMA,
      budgets: { pilotMaxTurns: 14, emanationMaxTurns: 5, maxEmanations: 4, maxProposedEffects: 16 },
    },
  })
}

function platformAutomationTrigger(
  kind: string,
  mode: string,
  resourcePrefix: string,
  consent: ReturnType<typeof buildDomainTriggerConsent>,
) {
  return {
    kind,
    enabled: true,
    mode,
    ingress: 'internal-service' as const,
    adapter: 'platform-scheduler',
    consentRef: {
      graphId: consent.authorityGraphId,
      documentId: 'consent-platform-1-automation',
      expectedDigest: domainTriggerConsentDigest(consent),
    },
    sourceFence: { resourcePrefixes: [resourcePrefix], eventIdRequired: true, maxContextRefs: 256 },
  }
}
