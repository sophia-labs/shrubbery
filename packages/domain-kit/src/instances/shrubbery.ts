import { mintStandaloneAgentId } from '../agent-bundle.js'
import { buildDomainBuildRecipe, domainBuildRecipeDigest } from '../build-recipe.js'
import { buildDomainToolbeltGrant } from '../grant.js'
import { buildDomainInstanceSeed, type DomainInstanceSeed } from '../instance.js'
import { buildDomainTriggerConsent, domainTriggerConsentDigest } from '../trigger-consent.js'
import type { DomainCapabilityManifest } from '../types.js'
import { DOMAIN_AGENT_RESPONSE_SCHEMA, DOMAIN_SEED_EPOCH, GRAPH_READER_TOOLS, PLATFORM_STEWARD, standardDomainQueries } from './shared.js'

export const SHRUBBERY_DOMAIN = 'shrub'
export const SHRUBBERY_GRAPH_ID = 'shrubbery-domain'
export const SHRUBBERY_AGENT_NAME = 'shrub-1'
export const SHRUBBERY_ACCEPTANCE_PROGRAM_ID = 'shrubbery.acceptance.hoja-v1'
export const SHRUBBERY_ACCEPTANCE_WORKFLOW_NAME = 'hoja-cross-modal-swarm-v1'
export const SHRUBBERY_ACCEPTANCE_WORKFLOW_URI = `urn:sophia:wf:${SHRUBBERY_ACCEPTANCE_WORKFLOW_NAME}`
/** Digest of Choreograph's registered HOJA_SWARM_SCRIPT definition. */
export const SHRUBBERY_ACCEPTANCE_DEFINITION_DIGEST =
  '2a9885a595e8d986e99904dd8d25549b2520598e9c341b47439b4bad11de58ad'

export const SHRUBBERY_PLANTER_BUILD_RECIPE = buildDomainBuildRecipe({
  recipeId: 'shrubbery.planter',
  repository: 'sophia-labs/shrubbery',
  contextSubdir: '.',
  dockerfile: 'Dockerfile.planter',
  dockerfileSha256: '5d1eabcc76760d1b44f936c455766c10a876ae5d4f5554ef1a99ad00306c84ef',
  checkScript: 'native-builder-check.sh',
  checkScriptSha256: 'c4371bbe4679e9a99198c3afdee12787e6fadc76ee82bccaf7c83212d53a57ca',
  imageRepository: 'planter-pool',
  instanceType: 'c6i.2xlarge',
  maxImageBytes: 536_870_912,
  maxDurationSeconds: 3_300,
  estimatedCostMicrousd: 2_500_000,
  cargoJobs: 1,
  requireCheck: true,
  requireLockArtifact: false,
  pushImage: true,
})
export const SHRUBBERY_PLANTER_BUILD_RECIPE_DIGEST = domainBuildRecipeDigest(SHRUBBERY_PLANTER_BUILD_RECIPE)

export const SHRUBBERY_CHARTER = `# shrub-1 charter

Be the Shrubbery specialist's general domain colleague. Attend to direct questions, review requests, scheduled work, and relevant graph events. Begin each revival by orienting from the current charter, manifest, ledger, evidence, and memory. Decide freely whether to answer directly, invoke a deterministic domain program, or delegate a small independent investigation to bounded read-only emanations. Emanations report to the central pilot; they never own the final judgment or an effect path.

Acceptance is a primary responsibility and program, not the whole identity. When acceptance work is appropriate, derive claims from the ratified Garden fidelity manifest. Exercise the smallest journey set that traverses every meaningful state transition and authority boundary. Capture content-addressed browser, backend, graph, and testimony evidence for every verdict. A PASS is always scoped by capability, mode, role, and target SHA. Refuse to call the port complete while any in-scope claim is untested, stale, blocked, contradicted by the backend, or missing reproducible evidence.

Prefer deterministic program beats. Use model judgment only for bounded journey synthesis, visual interpretation, and failure triage. Emanations may inspect independent claims but never own the final verdict. Browser actions stay origin-clamped; graph writes stay in shrubbery-domain; sites stay in the granted site-shrub1-* namespace. Publishing, retirement, destructive operations, and merges remain human decisions. Every mutation is a proposed effect and every effect needs a host receipt. The process is absent between waves; identity, charter, evidence, verdicts, career, and memory persist in the graph.`

export const SHRUBBERY_PROMPT = `You are shrub-1, the Shrubbery frontend specialist's domain colleague. Treat the current trigger as a request for judgment, not as a hard-coded workflow selector. Orient first. If the specialist asks a direct question, answer it directly. If the trigger calls for domain work, choose the best granted instrument. Invoke the acceptance program only when acceptance work is actually called for. Delegate only small independent read-only investigations and integrate their testimony yourself.

For acceptance work, choose the stalest or untested in-scope claim, locate its manifest journey, and run the smallest honest experiment that can change our knowledge. Never optimize for a green dashboard. Optimize for a reproducible scoped verdict. Read the manifest, query catalogue, prior verdicts, and memory before planning. Name target SHA, mode, role, capability, journey, and expected evidence.

Write a verdict only by proposing capability domain.verdict, operation write, with arguments { resource: "domain:shrub:verdict", graphId: "shrubbery-domain", verdict: { domain: "shrub", capabilityId, mode, role, targetSha256, outcome, evidence, reason? } }. Every evidence item is { uri, sha256, mediaType?, label? }, and the same URIs must appear in the proposal evidenceRefs. The host supplies the verdict id, as-of time, session witness, vocabulary, projection target, and apply decision. Return typed proposed effects for browser runs, verdict writes, dashboard refreshes, sites, builds, scratch cells, or GitHub activity; never imply that proposing performed them.`

export const SHRUBBERY_DAY_ONE_RUNBOOK = `# Your Shrubbery Domain

You have three things: a Sophia account, the \`shrubbery-domain\` cell, and shrub-1, your graph-defined domain colleague. The account is your human authority. The cell is the durable shared workspace. shrub-1 is absent as a process until a permitted trigger revives one bounded Choreograph wave.

## Enter and attach

1. Sign in to the canary Garden surface with the account from your invitation and open \`shrubbery-domain\`.
2. Open the domain dashboard. UNKNOWN means missing or stale testimony; it is not a failure and never silently becomes PASS.
3. From Vehicle or Greenhouse, select shrub-1's current run and claim the driver lease before steering. A second controller must receive \`not_driver\` rather than racing you.

## Work with shrub-1

- Ping shrub-1 for a question, review, or acceptance task. The trigger wakes the same graph identity in a fresh sandbox.
- Watch Contract A run events, pause at a journey boundary, or steer the next beat. Steering changes the attempt; it cannot add tools or bypass an approval boundary.
- Review filmstrip and other content-addressed evidence before accepting a verdict. PASS, FAIL, and BLOCKED remain visible and reproducible.
- Edit \`shrub-1-prompt\` as an authored graph document, review the change, and promote a new immutable prompt snapshot. Existing receipts continue to name the revision they actually used.
- Edit \`domain-capability-manifest\` when the domain changes. Re-run the Domain Kit seed/projection check; changed or new claims become explicit stale/untested work rather than inheriting old verdicts.

## Authority boundaries

The charter requests behavior; \`grant-shrub-1\` in the Platform Domain authorizes exact operations, fences, quotas, and approval policies. Browser, graph, workflow, verdict, site, build, scratch-cell, and GitHub mutations are typed proposals until the durable host edge validates and receipts them. Site mint/update may be routine only when that backend is present; public publish and retirement are always human-approved. GitHub merge is always human-approved. Layer 0 owns those mechanisms and grants; this domain owns its manifest, charter, prompt, evidence interpretation, and working practice.

Your account created this cell, so its exact owner principal is yours from birth; Sophia does not simulate an ownership transfer. The platform steward may retain a temporary editor grant for setup, which you review during handoff. Your viewer grant on the exact Platform-authority owner + \`observatory\` graph tuple lets the host resolve \`grant-shrub-1\`; a graph id without its owner is not authority. Your Hoja editor grant is separately scoped to that campaign's exact owner + \`obs-hoja-canary\` tuple. Vehicle uses the normal owner-scoped Choreograph route for this cell rather than a hidden second ACL.

When a wave ends, verify its receipt and that no sandbox remains. Identity, memory, sessions, evidence, and verdicts persist in Garden; the reasoning process does not.
`

export function buildShrubberyDomainInstance(
  manifest: DomainCapabilityManifest | unknown,
  input: { readonly promotedAt?: number; readonly promotedBy?: string } = {},
): DomainInstanceSeed {
  const promotedAt = input.promotedAt ?? DOMAIN_SEED_EPOCH
  const promotedBy = input.promotedBy ?? PLATFORM_STEWARD
  const agentId = mintStandaloneAgentId(SHRUBBERY_AGENT_NAME)
  const automationConsent = buildDomainTriggerConsent({
    consentId: 'consent-shrub-1-automation',
    subjectAgentId: agentId,
    issuedBy: promotedBy,
    authorityGraphId: 'observatory',
    adapter: 'domain-scheduler',
    triggerKinds: ['shrubbery.acceptance.tick', 'shrubbery.claim.stale'],
    sourcePrefixes: ['graph:shrubbery-domain:', 'observatory:shrubbery:'],
    issuedAt: promotedAt,
    status: 'active',
    maxContextRefs: 256,
    maxContextBytes: 1_048_576,
    retention: 'graph-referenced',
    sourceRefs: ['urn:sophia:review:trigger-consent:shrub-1-automation'],
  })
  const grant = buildDomainToolbeltGrant({
    grantId: 'grant-shrub-1',
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
        fence: { graphIds: [SHRUBBERY_GRAPH_ID], maxPayloadBytes: 1_048_576 },
        quota: { maxPerWave: 32, maxPerDay: 2_000 },
      },
      {
        capability: 'domain.verdict',
        operations: ['write'],
        access: 'write',
        approvalPolicy: 'ordinary',
        fence: {
          graphIds: [SHRUBBERY_GRAPH_ID],
          resourcePrefixes: [`domain:${SHRUBBERY_DOMAIN}:`],
          maxPayloadBytes: 262_144,
        },
        quota: { maxPerWave: 8, maxPerDay: 1_000 },
      },
      {
        capability: 'browser',
        operations: ['navigate', 'interact', 'capture_beat'],
        access: 'write',
        approvalPolicy: 'ordinary',
        fence: {
          originPrefixes: ['https://garden.canary.sophia-labs.com/', 'https://api.canary.sophia-labs.com/g/'],
          resourcePrefixes: ['hoja:', 'organism:'],
        },
        quota: { maxPerWave: 96, maxConcurrent: 2, maxCostMicrousd: 2_000_000 },
      },
      {
        capability: 'workflow',
        operations: ['loom_run'],
        access: 'write',
        approvalPolicy: 'ordinary',
        fence: {
          graphIdPrefixes: ['obs-hoja-'],
          resourcePrefixes: ['shrubbery:program:', 'shrubbery:journey:'],
          maxPayloadBytes: 262_144,
        },
        quota: { maxPerWave: 8, maxConcurrent: 8, maxCostMicrousd: 2_000_000 },
      },
      {
        capability: 'site',
        operations: ['mint', 'update', 'publish', 'retire'],
        access: 'write',
        approvalPolicy: 'ordinary',
        operationPolicies: { publish: 'human-always', retire: 'human-always' },
        fence: { graphIdPrefixes: ['site-shrub1-'], resourcePrefixes: ['site-shrub1-'], maxPayloadBytes: 1_048_576 },
        quota: { maxPerWave: 4, maxPerDay: 20, maxConcurrent: 2 },
      },
      {
        capability: 'build',
        operations: ['build.plan', 'build.start'],
        access: 'write',
        approvalPolicy: 'notify',
        fence: {
          resourcePrefixes: ['sophia-labs/shrubbery'],
          pathPrefixes: ['apps/', 'packages/'],
          builderRecipeDigests: [SHRUBBERY_PLANTER_BUILD_RECIPE_DIGEST],
          maxPayloadBytes: 1_048_576,
        },
        quota: { maxPerWave: 2, maxConcurrent: 1, maxCostMicrousd: 5_000_000 },
      },
      {
        capability: 'cell.scratch',
        operations: ['cell.launch', 'cell.inspect', 'cell.teardown'],
        access: 'write',
        approvalPolicy: 'ordinary',
        fence: {
          graphIdPrefixes: ['dev-shrub1-'],
          resourcePrefixes: ['sophia-labs/shrubbery'],
          maxPayloadBytes: 1_048_576,
          maxTtlHours: 8,
        },
        quota: { maxPerWave: 2, maxConcurrent: 1 },
      },
      {
        capability: 'github',
        operations: ['git.read', 'branch.push', 'pr.open', 'pr.comment', 'pr.merge'],
        access: 'write',
        approvalPolicy: 'ordinary',
        operationPolicies: { 'pr.open': 'notify', 'pr.comment': 'notify', 'pr.merge': 'human-always' },
		fence: {
		  branchPrefixes: ['agent/shrub-1/'],
		  resourcePrefixes: ['sophia-labs/shrubbery'],
		  pathPrefixes: ['apps/', 'packages/'],
		},
        quota: { maxPerWave: 8, maxPerDay: 40, maxConcurrent: 1 },
      },
    ],
    sourceRefs: ['urn:sophia:review:domain-agent-grant:shrub-1'],
  })
  return buildDomainInstanceSeed({
    domain: SHRUBBERY_DOMAIN,
    graphId: SHRUBBERY_GRAPH_ID,
    manifest,
    queries: standardDomainQueries(SHRUBBERY_DOMAIN),
    dashboard: {
      layoutId: 'shrubbery-domain-dashboard-v1',
      surfaceIri: 'urn:sophia:ux:surface:shrubbery-domain',
      stats: [
        { id: 'claim-counts', label: 'Declared claims', queryName: 'urn:sophia:query:shrub.claims.summary', format: 'number' },
        { id: 'coverage', label: 'Verdict coverage', queryName: 'urn:sophia:query:shrub.verdicts.coverage', format: 'percent' },
        { id: 'attention', label: 'Needs attention', queryName: 'urn:sophia:query:shrub.verdicts.attention-count', format: 'number' },
        { id: 'freshness', label: 'Last evidenced', queryName: 'urn:sophia:query:shrub.freshness', format: 'dateTimeRelative' },
      ],
      verdictsQueryName: 'urn:sophia:query:shrub.verdicts.current',
      freshnessQueryName: 'urn:sophia:query:shrub.freshness',
      details: {
        queueQueryName: 'urn:sophia:query:shrub.claims.untested',
        evidenceQueryName: 'urn:sophia:query:shrub.evidence.recent',
        evidenceGraphId: 'obs-hoja-canary',
        attentionQueryName: 'urn:sophia:query:shrub.verdicts.attention',
        evidenceTitle: 'Latest Hoja acceptance evidence',
      },
      generatedAt: new Date(promotedAt).toISOString(),
      maxAgeSeconds: 86_400,
    },
    additionalGraphDocuments: {
      'shrubbery-day-one': SHRUBBERY_DAY_ONE_RUNBOOK,
    },
    agent: {
      registeredName: SHRUBBERY_AGENT_NAME,
      homeGraphId: SHRUBBERY_GRAPH_ID,
      agentRef: 'urn:sophia:domain-agent:shrub-1',
      ontologyRefs: ['urn:sophia:ontology:agent:v2', 'urn:sophia:domain-kit:v1', 'urn:sophia:domain:shrubbery:v1'],
      charter: SHRUBBERY_CHARTER,
      prompt: SHRUBBERY_PROMPT,
      promotedBy,
      promotedAt,
      grant,
      directTools: GRAPH_READER_TOOLS,
      programs: [
        {
          programId: SHRUBBERY_ACCEPTANCE_PROGRAM_ID,
          title: 'Hoja cross-modal acceptance wave',
          description:
            'Replay a graph-stored Hoja scenario across Meaningful Object doors and return evidence-scoped I1-I5 verdicts.',
          workflowName: SHRUBBERY_ACCEPTANCE_WORKFLOW_NAME,
          workflowUri: SHRUBBERY_ACCEPTANCE_WORKFLOW_URI,
          definitionDigest: SHRUBBERY_ACCEPTANCE_DEFINITION_DIGEST,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['scenario', 'digest', 'graphId'],
            properties: {
              scenario: { type: 'object' },
              digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
              graphId: { type: 'string', pattern: '^obs-hoja-[A-Za-z0-9._-]+$' },
            },
          },
          authority: {
            capability: 'workflow',
            operation: 'loom_run',
            access: 'write',
            resourceRef: 'shrubbery:program:hoja-cross-modal-swarm-v1',
          },
          graph: { mode: 'input-field', inputField: 'graphId' },
        },
      ],
      triggers: [
        {
          kind: 'shrubbery.message',
          enabled: true,
          mode: 'direct-domain-ping',
          ingress: 'owner',
          sourceFence: {
            resourcePrefixes: ['graph:shrubbery-domain:', 'vehicle:shrubbery-domain:'],
            eventIdRequired: true,
            maxContextRefs: 256,
          },
        },
        shrubAutomationTrigger(
          'shrubbery.acceptance.tick',
          'scheduled',
          'graph:shrubbery-domain:',
          automationConsent,
        ),
        shrubAutomationTrigger(
          'shrubbery.claim.stale',
          'ledger-event',
          'observatory:shrubbery:',
          automationConsent,
        ),
        {
          kind: 'shrubbery.review.requested',
          enabled: true,
          mode: 'human-request',
          ingress: 'owner',
          sourceFence: { resourcePrefixes: ['graph:shrubbery-domain:'], eventIdRequired: true, maxContextRefs: 256 },
        },
      ],
      triggerConsents: { 'consent-shrub-1-automation': automationConsent },
      responseSchema: DOMAIN_AGENT_RESPONSE_SCHEMA,
      budgets: {
        pilotMaxTurns: 16,
        emanationMaxTurns: 6,
        maxEmanations: 8,
        maxProposedEffects: 32,
        maxProgramInvocations: 1,
      },
    },
  })
}

function shrubAutomationTrigger(
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
    adapter: 'domain-scheduler',
    consentRef: {
      graphId: consent.authorityGraphId,
      documentId: 'consent-shrub-1-automation',
      expectedDigest: domainTriggerConsentDigest(consent),
    },
    sourceFence: { resourcePrefixes: [resourcePrefix], eventIdRequired: true, maxContextRefs: 256 },
  }
}
