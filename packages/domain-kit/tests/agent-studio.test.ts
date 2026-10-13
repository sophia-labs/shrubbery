import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  compileAgentStudioProfile,
  createSophiaClusterLeadProfile,
  parseAgentStudioProfile,
  SOPHIA_1_GARDEN_TOOL_POLICY,
  SOPHIA_1_HELM_READ_OPERATIONS,
  SOPHIA_1_HOME_BOOTSTRAP,
  SOPHIA_1_KUBERNETES_READ_OPERATIONS,
  SOPHIA_1_RESIDENT_IDENTITY,
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
    expect(profile).toMatchObject({
      registeredName: SOPHIA_1_RESIDENT_IDENTITY.registeredName,
      displayName: 'Sophia-1 · Sophia Cluster Lead',
      home: { ownerPrincipal: 'user:vera', graphId: SOPHIA_1_RESIDENT_IDENTITY.homeGraphId },
    })
    expect(profile.tools.map(tool => tool.name)).toEqual([
      ...SOPHIA_1_GARDEN_TOOL_POLICY.map(([name]) => name),
      ...SOPHIA_1_KUBERNETES_READ_OPERATIONS,
      ...SOPHIA_1_HELM_READ_OPERATIONS,
    ])
    expect(profile.tools.filter(tool => tool.destructive).map(tool => tool.name)).toEqual(['delete_document', 'delete_blocks'])
    expect(profile.grant.capabilities).toEqual([
      expect.objectContaining({
        capability: 'mnemosyne',
        operations: SOPHIA_1_GARDEN_TOOL_POLICY.map(([name]) => name),
        fence: expect.objectContaining({ graphIds: ['sophia-cluster'] }),
        operationPolicies: { delete_document: 'human-always', delete_blocks: 'human-always' },
      }),
      expect.objectContaining({
        capability: 'kubernetes.read',
        operations: SOPHIA_1_KUBERNETES_READ_OPERATIONS,
        access: 'read',
        fence: expect.objectContaining({ resourcePrefixes: ['cluster:mnemosyne-dev'] }),
      }),
      expect.objectContaining({
        capability: 'helm.read',
        operations: SOPHIA_1_HELM_READ_OPERATIONS,
        access: 'read',
        fence: expect.objectContaining({ resourcePrefixes: ['cluster:mnemosyne-dev'] }),
      }),
    ])
    expect(SOPHIA_1_HOME_BOOTSTRAP).toEqual({
      graphId: 'sophia-cluster',
      preserve: ['_sophia'],
      createWhenAbsent: ['Journal', 'Investigations', 'Projects', 'Handoffs'],
    })
    expect(profile.prompt).toContain('host, not your tool arguments, supplies your observer, owner, and graph coordinates')
    expect(profile.prompt).toContain('Never overwrite or repurpose _sophia')
    expect(profile.prompt).toContain('survives body compost/regrowth, but v1 does not claim durability across Choreograph host replacement')
    expect(profile.prompt).toContain('Bash is local to that body: it has no host paths, credentials, ambient network, remote push, or credentialed fetch')
    expect(profile.prompt).toContain('Kubernetes describes observed live state. Helm describes declared release intent')
    expect(publication.definition).toMatchObject({
      schema: 'sophia.domain-agent-definition.v2',
      registeredName: 'sophia-1',
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
      policy: { requireApprovalFor: string[] }
      capabilities: Array<{ scope: { graphId: string } }>
      tools: Array<{ name: string; capability: string; destructive: boolean; approvalPolicy: { mode: string; driverRequired?: boolean } }>
    }
    expect(manifest.policy.requireApprovalFor).toEqual(['dangerous', 'external-side-effect'])
    expect(manifest.capabilities.map(capability => capability.scope.graphId)).toEqual(['sophia-cluster', 'sophia-cluster', 'sophia-cluster'])
    expect(manifest.tools).toHaveLength(53)
    expect(manifest.tools.filter(tool => tool.approvalPolicy.mode === 'always')).toEqual([
      expect.objectContaining({ name: 'delete_document', destructive: true, approvalPolicy: { mode: 'always', driverRequired: true } }),
      expect.objectContaining({ name: 'delete_blocks', destructive: true, approvalPolicy: { mode: 'always', driverRequired: true } }),
    ])
    expect(manifest.tools.filter(tool => tool.name === 'remember' || tool.name === 'write_document' || tool.name === 'sing')).toEqual([
      expect.objectContaining({ name: 'sing', destructive: false, approvalPolicy: { mode: 'never' } }),
      expect.objectContaining({ name: 'remember', destructive: false, approvalPolicy: { mode: 'never' } }),
      expect.objectContaining({ name: 'write_document', destructive: false, approvalPolicy: { mode: 'never' } }),
    ])
    expect(manifest.tools.filter(tool => tool.capability === 'kubernetes.read').map(tool => tool.name)).toEqual(SOPHIA_1_KUBERNETES_READ_OPERATIONS)
    expect(manifest.tools.filter(tool => tool.capability === 'helm.read').map(tool => tool.name)).toEqual(SOPHIA_1_HELM_READ_OPERATIONS)
    const pilotRuntime = JSON.parse(publication.homeDocuments[Object.keys(publication.homeDocuments).find(id => id.includes('-pilot-runtime-'))!])
    const emanationRuntime = JSON.parse(publication.homeDocuments[Object.keys(publication.homeDocuments).find(id => id.includes('-emanation-runtime-'))!])
    expect(pilotRuntime.constraints.allowWorkspaceShell).toBe(true)
    expect(emanationRuntime.constraints.allowWorkspaceShell).toBe(false)
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
    expect(() => parseAgentStudioProfile({
      ...profile,
      grant: {
        ...profile.grant,
        capabilities: [{
          ...profile.grant.capabilities[0]!,
          operationPolicies: { sparql_update: 'human-always' },
        }],
      },
    })).toThrow(/ungranted operation/)
    expect(() => parseAgentStudioProfile({
      ...profile,
      runtimes: {
        ...profile.runtimes,
        pilot: {
          ...profile.runtimes.pilot,
          constraints: { ...profile.runtimes.pilot.constraints, allowWorkspaceShell: 'yes' },
        },
      },
    })).toThrow(/allowWorkspaceShell must be boolean/)
  })
})
