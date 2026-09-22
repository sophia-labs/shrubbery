import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parseNT } from '@shrubbery/nucleus'
import { describe, expect, it } from 'vitest'
import { DOMAIN_AUTHORITY_OWNER_BINDING } from '../src/agent-bundle.js'
import { assertOneLayoutLiteral } from '../src/dashboard.js'
import {
  buildPhanesDomainInstance,
  buildPlatformDomainInstance,
  buildShrubberyDomainInstance,
  PHANES_GRAPH_ID,
  PLATFORM_GRAPH_ID,
  SHRUBBERY_GRAPH_ID,
  SHRUBBERY_PLANTER_BUILD_RECIPE,
  SHRUBBERY_PLANTER_BUILD_RECIPE_DIGEST,
} from '../src/instances/index.js'
import { checkManifestProjection } from '../src/manifest.js'

const gardenManifestPath = fileURLToPath(
  new URL('../../../docs/acceptance/garden-capability-manifest.json', import.meta.url),
)

describe('concrete Domain Kit instances', () => {
  it('stands up the Platform Domain as a second domain without a new schema', () => {
    const platform = buildPlatformDomainInstance()

    expect(platform.schema).toBe('sophia.domain-instance-seed.v1')
    expect(platform.graphId).toBe(PLATFORM_GRAPH_ID)
    expect(platform.manifest.capabilities).toHaveLength(4)
    expect(platform.agent.definition).toMatchObject({
      homeGraphId: PLATFORM_GRAPH_ID,
      models: {
        provider: 'openrouter',
        pilot: 'thinkingmachines/inkling',
        emanation: 'thinkingmachines/inkling-small',
      },
    })
    expect(platform.authorityDocuments['grant-platform-1']).toContain('grant-admin')
    expect(platform.projectionIngests.map((ingest) => ingest.vocab)).toEqual([
      'sophia-domain-manifest',
      'sophia-domain-dashboard',
    ])
    expect(platform.projectionIngests.every((ingest) => ingest.replaceClass)).toBe(true)
    expect(platform.graphDocuments['domain-query-catalogue']).toContain('urn:sophia:query:platform.freshness')
    assertOneLayoutLiteral(platform.dashboard.triples, 'urn:sophia:ux:surface:platform-domain')
    expect(checkManifestProjection(platform.manifest, parseNT(platform.rdfImports[0].content)).ok).toBe(true)
  })

  it('materializes the real 80-claim Shrubbery program with its fenced Layer 0 grant', async () => {
    const source = JSON.parse(await readFile(gardenManifestPath, 'utf8'))
    const shrubbery = buildShrubberyDomainInstance(source)

    expect(shrubbery.graphId).toBe(SHRUBBERY_GRAPH_ID)
    expect(shrubbery.manifest.capabilities).toHaveLength(80)
    expect(shrubbery.agent.definition).toMatchObject({
      registeredName: 'shrub-1',
      homeGraphId: SHRUBBERY_GRAPH_ID,
      grantRef: {
        ownerPrincipal: DOMAIN_AUTHORITY_OWNER_BINDING,
        graphId: PLATFORM_GRAPH_ID,
        documentId: 'grant-shrub-1',
      },
    })
    const definition = shrubbery.agent.definition as {
      triggers: Array<{ kind: string; mode?: string }>
      programs: Array<{ programId: string; workflowName: string; workflowUri: string; definitionDigest: string }>
      budgets: { maxProgramInvocations: number }
    }
    expect(definition.triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'shrubbery.message',
        mode: 'direct-domain-ping',
        ingress: 'owner',
      }),
      expect.objectContaining({
        kind: 'shrubbery.acceptance.tick',
        mode: 'scheduled',
        ingress: 'internal-service',
      }),
    ]))
    expect(definition.programs).toEqual([
      expect.objectContaining({
        programId: 'shrubbery.acceptance.hoja-v1',
        workflowName: 'hoja-cross-modal-swarm-v1',
        workflowUri: 'urn:sophia:wf:hoja-cross-modal-swarm-v1',
        definitionDigest: '2a9885a595e8d986e99904dd8d25549b2520598e9c341b47439b4bad11de58ad',
      }),
    ])
    expect(definition.budgets.maxProgramInvocations).toBe(1)
    expect(shrubbery.catalogue.queries.map((query) => query.name)).toEqual(expect.arrayContaining([
      'urn:sophia:query:shrub.claims.untested',
      'urn:sophia:query:shrub.evidence.recent',
      'urn:sophia:query:shrub.verdicts.attention',
      'urn:sophia:query:shrub.agent.sessions',
    ]))
    const dashboardLayout = JSON.stringify(shrubbery.dashboard.layout)
    expect(dashboardLayout).toContain('obs.filmstrip')
    expect(dashboardLayout).toContain('card.subject')
    expect(dashboardLayout).toContain('obs-hoja-canary')
    expect(shrubbery.graphDocuments['shrub-1-charter']).toMatch(/general domain colleague/i)
    expect(shrubbery.graphDocuments['shrub-1-charter']).toMatch(/Acceptance is a primary responsibility and program/i)
    expect(shrubbery.graphDocuments['shrub-1-prompt']).toMatch(/not as a hard-coded workflow selector/i)
    expect(shrubbery.graphDocuments['shrubbery-day-one']).toMatch(/account.*cell.*shrub-1/is)
    expect(shrubbery.graphDocuments['shrubbery-day-one']).toMatch(/claim the driver lease/i)
    expect(shrubbery.graphDocuments['shrubbery-day-one']).toMatch(/public publish and retirement are always human-approved/i)
    const grant = JSON.parse(shrubbery.authorityDocuments['grant-shrub-1'])
    expect(grant.capabilities.find((entry: { capability: string }) => entry.capability === 'site')).toMatchObject({
      operationPolicies: { publish: 'human-always', retire: 'human-always' },
      fence: { graphIdPrefixes: ['site-shrub1-'] },
    })
    expect(grant.capabilities.find((entry: { capability: string }) => entry.capability === 'github')).toMatchObject({
      operationPolicies: { 'pr.open': 'notify', 'pr.merge': 'human-always' },
      fence: { branchPrefixes: ['agent/shrub-1/'], pathPrefixes: ['apps/', 'packages/'] },
    })
    expect(grant.capabilities.find((entry: { capability: string }) => entry.capability === 'build')).toMatchObject({
      fence: {
        resourcePrefixes: ['sophia-labs/shrubbery'],
        builderRecipeDigests: [SHRUBBERY_PLANTER_BUILD_RECIPE_DIGEST],
      },
    })
    expect(SHRUBBERY_PLANTER_BUILD_RECIPE).toMatchObject({
      schema: 'sophia.build-recipe.v1',
      recipeId: 'shrubbery.planter',
      repository: 'sophia-labs/shrubbery',
      requireCheck: true,
      pushImage: true,
    })
  })

  it('captures Phanes as the stronger listener-plus-disposable-wave precedent', () => {
    const phanes = buildPhanesDomainInstance()
    const definition = phanes.agent.definition as {
      triggers: Array<{ kind: string; mode?: string }>
      emanations: { depth: number }
    }

    expect(phanes.graphId).toBe(PHANES_GRAPH_ID)
    expect(definition.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'discord.message.mention',
          enabled: true,
          mode: 'reply-to-trigger',
          ingress: 'internal-service',
          adapter: 'discord',
        }),
        expect.objectContaining({
          kind: 'discord.message.ambient',
          enabled: true,
          mode: 'consented-listener',
          ingress: 'internal-service',
          adapter: 'discord',
        }),
        expect.objectContaining({
          kind: 'discord.voice.utterance',
          enabled: true,
          mode: 'consented-listener',
          ingress: 'internal-service',
          adapter: 'discord',
        }),
      ]),
    )
    expect(definition.emanations.depth).toBe(1)
    expect(phanes.graphDocuments['phanes-charter']).toMatch(/No agent process survives the wave/i)
    expect(phanes.graphDocuments['phanes-prompt']).toMatch(/durable host owns the target/i)
    expect(phanes.authorityDocuments['grant-phanes']).toMatch(/discord.*message\.reply/s)
    expect(phanes.authorityDocuments['grant-phanes']).toMatch(/discord:guild:/)
    expect(phanes.authorityDocuments['grant-phanes']).not.toMatch(/discord:trigger:/)
    expect(phanes.authorityDocuments['consent-phanes-discord']).toMatch(/graph-referenced/)
    expect(phanes.graphDocuments['grant-phanes']).toBeUndefined()
  })
})
