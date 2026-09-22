import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  compileAgentStudioProfile,
  createSophiaClusterLeadProfile,
  parseAgentStudioProfile,
  SOPHIA_CLUSTER_LEAD_HARNESS,
  SOPHIA_CLUSTER_LEAD_HARNESS_DIGEST,
} from '../src/agent-studio.js'

const runtimeDigest = `sha256:${'a'.repeat(64)}`
const context = {
  promotedBy: 'user:vera',
  promotedAt: 1_800_000_000_000,
  promptDocument: { revision: 1, changeId: 'change-1' },
} as const

describe('Agent Studio profile compiler', () => {
  it('compiles a fresh Sophia Cluster lead into current Choreograph v2 authority', async () => {
    const profile = createSophiaClusterLeadProfile({ ownerPrincipal: 'user:vera', runtimeBundleDigest: runtimeDigest })
    const publication = await compileAgentStudioProfile(profile, context)

    expect(publication.agentId).toMatch(/^agent-[0-9a-f]{16}$/)
    expect(publication.agentId).toBe(SOPHIA_CLUSTER_LEAD_HARNESS.agentId)
    expect(publication.definition).toMatchObject({
      schema: 'sophia.domain-agent-definition.v2',
      registeredName: 'sophia-cluster-lead',
      homeGraphId: 'sophia-cluster',
      runtimes: {
        pilot: { schema: 'choreograph.agent-runtime-binding.v2', kind: 'prime' },
        emanation: { schema: 'choreograph.agent-runtime-binding.v2', kind: 'simple' },
      },
      grantRef: { ownerPrincipal: 'user:vera', graphId: 'observatory' },
    })
    const ontology = publication.definition.ontology as { objects: Record<string, unknown> }
    expect(ontology.objects).toMatchObject({
      agent: { kind: 'agent', ownerPrincipal: 'user:vera', graphId: 'sophia-cluster' },
      geist: { kind: 'geist' },
      prompt: { kind: 'prompt' },
      harness: { kind: 'harness' },
      toolManifest: { kind: 'tool-manifest' },
      toolGrant: { kind: 'tool-grant', graphId: 'observatory' },
    })
    const manifest = JSON.parse(publication.homeDocuments[publication.activeDocumentIds.toolManifest]) as {
      tools: Array<{ name: string; destructive: boolean }>
    }
    expect(manifest.tools.map(tool => [tool.name, tool.destructive])).toEqual([
      ['recall', false],
      ['search_documents', false],
      ['remember', true],
    ])
    expect(publication.authorityDocuments[publication.activeDocumentIds.grant]).toContain(publication.agentId)
    expect(publication.homeDocuments['domain-agent-definition']).toContain('sophia.domain-agent-definition.v2')
    const harnessDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(SOPHIA_CLUSTER_LEAD_HARNESS))))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('')
    expect(harnessDigest).toBe(SOPHIA_CLUSTER_LEAD_HARNESS_DIGEST)
    expect(ontology.objects.harness).toMatchObject({ digest: `sha256:${harnessDigest}` })
  })

  it('is deterministic for the same profile and publication context', async () => {
    const profile = createSophiaClusterLeadProfile({ ownerPrincipal: 'user:vera', runtimeBundleDigest: runtimeDigest })
    expect(await compileAgentStudioProfile(profile, context)).toEqual(await compileAgentStudioProfile(profile, context))
  })

  it('uses versioned dependencies and keeps the active definition as the sole stable pointer', async () => {
    const profile = createSophiaClusterLeadProfile({ ownerPrincipal: 'user:vera', runtimeBundleDigest: runtimeDigest })
    const first = await compileAgentStudioProfile(profile, context)
    const second = await compileAgentStudioProfile(
      { ...profile, prompt: `${profile.prompt}\n\nPrefer smaller commits.` },
      { ...context, promotedAt: context.promotedAt + 1, promptDocument: { revision: 1, changeId: 'change-2' } },
    )
    expect(first.activeDocumentIds.prompt).not.toBe(second.activeDocumentIds.prompt)
    expect(first.definitionDocumentId).toBe('domain-agent-definition')
    expect(second.definitionDocumentId).toBe('domain-agent-definition')
  })

  it('rejects unsafe widening and unknown testimony', () => {
    const profile = createSophiaClusterLeadProfile({ ownerPrincipal: 'user:vera', runtimeBundleDigest: runtimeDigest })
    expect(() => parseAgentStudioProfile({ ...profile, ambientAuthority: true })).toThrow(/unknown field/)
    expect(() => parseAgentStudioProfile({
      ...profile,
      runtimes: {
        ...profile.runtimes,
        emanation: {
          ...profile.runtimes.emanation,
          constraints: { ...profile.runtimes.emanation.constraints, maxChildren: 1 },
        },
      },
    })).toThrow(/simple runtime topology/)
    expect(() => parseAgentStudioProfile({
      ...profile,
      tools: [...profile.tools, { ...profile.tools[0]!, name: 'ambient_write' }],
    })).toThrow(/absent from the grant operations/)
  })
})
