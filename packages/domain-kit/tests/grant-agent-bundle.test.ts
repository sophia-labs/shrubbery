import { describe, expect, it } from 'vitest'
import {
  buildDomainAgentSeedBundle,
  DOMAIN_AUTHORITY_OWNER_BINDING,
  mintStandaloneAgentId,
} from '../src/agent-bundle.js'
import { buildDomainToolbeltGrant, parseDomainToolbeltGrant } from '../src/grant.js'

const agentId = mintStandaloneAgentId('shrub-1')

function grant() {
  return buildDomainToolbeltGrant({
    grantId: 'grant-shrub-1',
    subjectAgentId: agentId,
    issuedBy: 'user:platform-steward',
    authorityGraphId: 'observatory',
    issuedAt: 1,
    status: 'active',
    capabilities: [
      {
        capability: 'mnemosyne',
        operations: ['recall', 'search_documents', 'sparql_update'],
        access: 'write',
        approvalPolicy: 'ordinary',
        fence: { graphIds: ['shrubbery-domain'], maxPayloadBytes: 65536 },
        quota: { maxPerWave: 8 },
      },
      {
        capability: 'site',
        operations: ['mint', 'publish', 'retire'],
        access: 'write',
        approvalPolicy: 'ordinary',
        operationPolicies: { publish: 'human-always', retire: 'human-always' },
        fence: { graphIdPrefixes: ['site-shrub1-'] },
        quota: { maxPerWave: 2, maxConcurrent: 1 },
      },
      {
        capability: 'workflow',
        operations: ['loom_run'],
        access: 'write',
        approvalPolicy: 'ordinary',
        fence: { graphIds: ['shrubbery-domain'], resourcePrefixes: ['shrubbery:program:'] },
        quota: { maxPerWave: 1, maxConcurrent: 1 },
      },
    ],
    sourceRefs: ['urn:sophia:grant-review:shrub-1'],
  })
}

describe('Domain Kit Layer 0 grant and graph-defined agent seed', () => {
  it('keeps per-operation human boundaries inside one capability', () => {
    const parsed = parseDomainToolbeltGrant(grant())
    const site = parsed.capabilities.find((capability) => capability.capability === 'site')
    expect(site?.approvalPolicy).toBe('ordinary')
    expect(site?.operationPolicies?.publish).toBe('human-always')
  })

  it('treats scratch lifetime as a numeric authority fence', () => {
    const scratch = buildDomainToolbeltGrant({
      ...grant(),
      grantId: 'grant-scratch',
      capabilities: [
        {
          capability: 'cell.scratch',
          operations: ['cell.launch'],
          access: 'write',
          approvalPolicy: 'ordinary',
          fence: {
            graphIdPrefixes: ['dev-shrub1-'],
            resourcePrefixes: ['sophia-labs/shrubbery'],
            maxTtlHours: 8,
          },
          quota: { maxConcurrent: 1 },
        },
      ],
    })
    expect(scratch.capabilities[0]?.fence.maxTtlHours).toBe(8)
    expect(() =>
      parseDomainToolbeltGrant({
        ...scratch,
        capabilities: [{ ...scratch.capabilities[0], fence: { ...scratch.capabilities[0]?.fence, maxTtlHours: 0 } }],
      }),
    ).toThrow(/maxTtlHours must be a positive integer/)
  })

  it('treats a builder recipe digest as exact host authority', () => {
    const recipeDigest = 'a'.repeat(64)
    const build = buildDomainToolbeltGrant({
      ...grant(),
      grantId: 'grant-build',
      capabilities: [
        {
          capability: 'build',
          operations: ['build.plan', 'build.start'],
          access: 'write',
          approvalPolicy: 'notify',
          fence: { resourcePrefixes: ['sophia-labs/shrubbery'], builderRecipeDigests: [recipeDigest] },
          quota: { maxConcurrent: 1, maxCostMicrousd: 5_000_000 },
        },
      ],
    })
    expect(build.capabilities[0]?.fence.builderRecipeDigests).toEqual([recipeDigest])
    expect(() =>
      parseDomainToolbeltGrant({
        ...build,
        capabilities: [{ ...build.capabilities[0], fence: { builderRecipeDigests: ['recipe-by-name'] } }],
      }),
    ).toThrow(/lowercase SHA-256/)
  })

  it('materializes a stable Inkling agent from documents while keeping the grant in the authority graph', () => {
    const bundle = buildDomainAgentSeedBundle({
      registeredName: 'shrub-1',
      homeGraphId: 'shrubbery-domain',
      agentRef: 'urn:sophia:domain-agent:shrub-1',
      ontologyRefs: ['urn:sophia:ontology:agent:v2', 'urn:sophia:domain-kit:v1'],
      charter: 'Derive claims from the manifest. Capture evidence for every verdict.',
      prompt: 'You are shrub-1. Exercise the smallest complete journey.',
      promotedBy: 'user:platform-steward',
      promotedAt: 1,
      grant: grant(),
      directTools: [
        {
          name: 'recall',
          title: 'Recall',
          description: 'Read prior domain memory.',
          capability: 'mnemosyne',
          access: 'read',
          risk: 'low',
          required: true,
        },
        {
          name: 'search_documents',
          title: 'Search documents',
          description: 'Find graph documents.',
          capability: 'mnemosyne',
          access: 'read',
          risk: 'low',
          required: true,
        },
      ],
      triggers: [{ kind: 'shrubbery.acceptance.tick', enabled: true }],
      programs: [
        {
          programId: 'shrubbery.acceptance.v1',
          title: 'Acceptance',
          description: 'Exercise a graph-stored acceptance journey.',
          workflowName: 'acceptance-v1',
          workflowUri: 'urn:sophia:wf:acceptance-v1',
          definitionDigest: 'a'.repeat(64),
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['claimRef'],
            properties: { claimRef: { type: 'string' } },
          },
          authority: {
            capability: 'workflow',
            operation: 'loom_run',
            access: 'write',
            resourceRef: 'shrubbery:program:acceptance-v1',
          },
          graph: { mode: 'home' },
        },
      ],
      responseSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
    })
    expect(bundle.agentId).toBe(agentId)
    expect(bundle.definition).toMatchObject({
      models: { provider: 'openrouter', pilot: 'thinkingmachines/inkling', emanation: 'thinkingmachines/inkling-small' },
      grantRef: {
        ownerPrincipal: DOMAIN_AUTHORITY_OWNER_BINDING,
        graphId: 'observatory',
        documentId: 'grant-shrub-1',
      },
      budgets: { maxProgramInvocations: 1 },
      programs: [
        {
          programId: 'shrubbery.acceptance.v1',
          workflowName: 'acceptance-v1',
          workflowUri: 'urn:sophia:wf:acceptance-v1',
          definitionDigest: 'a'.repeat(64),
        },
      ],
    })
    expect(bundle.homeDocuments['domain-agent-definition']).toContain('sophia.domain-agent-definition.v1')
    expect(bundle.grantAuthorityOwnerPrincipal).toBe(DOMAIN_AUTHORITY_OWNER_BINDING)
    expect(bundle.authorityDocuments['grant-shrub-1']).toContain('publish')
    expect(bundle.homeDocuments['grant-shrub-1']).toBeUndefined()
  })

  it('rejects executable coordinates that are unpinned or ambiguous', () => {
    const base = {
      registeredName: 'shrub-1',
      homeGraphId: 'shrubbery-domain',
      agentRef: 'urn:sophia:domain-agent:shrub-1',
      ontologyRefs: ['urn:sophia:ontology:agent:v2'],
      charter: 'Be a colleague.',
      prompt: 'Attend freely.',
      promotedBy: 'user:platform-steward',
      promotedAt: 1,
      grant: grant(),
      directTools: [],
      triggers: [{ kind: 'shrubbery.message', enabled: true }],
      responseSchema: { type: 'object' },
    } as const
    const invalid = {
      programId: 'acceptance',
      title: 'Acceptance',
      description: 'Exercise one claim.',
      workflowName: 'acceptance-v1',
      workflowUri: 'urn:sophia:wf:acceptance-v1',
      definitionDigest: 'unpinned',
      inputSchema: { type: 'object' },
      authority: {
        capability: 'workflow',
        operation: 'loom_run',
        access: 'write',
        resourceRef: 'shrubbery:program:acceptance-v1',
      },
      graph: { mode: 'home' },
    } as const
    expect(() => buildDomainAgentSeedBundle({ ...base, programs: [invalid] })).toThrow(/sha256/)
    const pinned = { ...invalid, definitionDigest: 'b'.repeat(64) }
    expect(() => buildDomainAgentSeedBundle({ ...base, programs: [pinned, pinned] })).toThrow(/duplicate programId/)
  })
})
