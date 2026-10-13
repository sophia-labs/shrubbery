import {
  canonicalJson,
  createSophiaClusterLeadProfile,
  SOPHIA_1_RESIDENT_IDENTITY,
  SOPHIA_CLUSTER_LEAD_HARNESS,
} from '@shrubbery/domain-kit/agent-studio'
import type { GatewayGraphInfo, GatewayMcpResult } from '@shrubbery/source/gateway'
import { describe, expect, it } from 'vitest'
import {
  operateSophiaClusterAgentStudio,
  SOPHIA_CLUSTER_AGENT_STUDIO_AUTHORITY_GRAPH,
  SOPHIA_CLUSTER_AGENT_STUDIO_TOOL_COUNT,
  type SophiaClusterAgentStudioGateway,
} from '../../../scripts/sophia-cluster-agent-studio-operator-lib.js'

const owner = 'user:vera'
const runtimeDigest = `sha256:${'a'.repeat(64)}`
const profile = createSophiaClusterLeadProfile({ ownerPrincipal: owner, runtimeBundleDigest: runtimeDigest })

class CellGateway implements SophiaClusterAgentStudioGateway {
  readonly documents = new Map<string, { content: string; revision: number; updatedAt: string }>()
  readonly writes: Array<{ graphId: string; documentId: string }> = []
  readonly bindings: Array<{ graphId: string; owner: string }> = []
  profileReads = 0
  conflictOnSecondProfileRead = false
  graphRows: readonly GatewayGraphInfo[] = [
    graph('sophia-cluster'),
    graph(SOPHIA_CLUSTER_AGENT_STUDIO_AUTHORITY_GRAPH),
  ]

  constructor(seedProfile = profile) {
    this.documents.set(key('sophia-cluster', 'agent-studio-profile'), {
      content: canonicalJson(seedProfile),
      revision: 1,
      updatedAt: '1',
    })
  }

  async graphs(): Promise<readonly GatewayGraphInfo[]> {
    return this.graphRows
  }

  bindGraphOwner(graphId: string, graphOwner: string): void {
    this.bindings.push({ graphId, owner: graphOwner })
  }

  async toolsCall(graphId: string, name: string, args: Readonly<Record<string, unknown>>): Promise<GatewayMcpResult> {
    return { structuredContent: await this.cellCall(graphId, name, args) }
  }

  private async cellCall(graphId: string, name: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const documentId = String(args.documentId)
    const coordinate = key(graphId, documentId)
    if (name === 'read_document') {
      if (documentId === 'agent-studio-profile') {
        this.profileReads += 1
        if (this.profileReads === 2 && this.conflictOnSecondProfileRead) {
          const current = this.documents.get(coordinate)!
          this.documents.set(coordinate, { ...current, revision: current.revision + 1, updatedAt: 'external' })
        }
      }
      const current = this.documents.get(coordinate)
      if (!current) throw new Error(`document not found: ${coordinate}`)
      return {
        content: current.content,
        revision: current.revision,
        updated_at: current.updatedAt,
        change_id: `change-${current.revision}`,
      }
    }
    if (name === 'write_document') {
      const current = this.documents.get(coordinate)
      const currentRevision = current?.revision ?? 0
      if (args.expectedRevision !== undefined && args.expectedRevision !== currentRevision) {
        throw new Error(`revision mismatch: expected ${String(args.expectedRevision)}, actual ${currentRevision}`)
      }
      const revision = currentRevision + 1
      const tiptap = args.tiptapJson as { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined
      const jsonText = tiptap?.content?.[0]?.content?.[0]?.text
      this.documents.set(coordinate, {
        content: jsonText === undefined ? String(args.content) : `\`\`\`json\n${jsonText}\n\`\`\``,
        revision,
        updatedAt: String(revision),
      })
      this.writes.push({ graphId, documentId })
      return { success: true }
    }
    throw new Error(`unexpected tool: ${name}`)
  }
}

describe('Sophia cluster Agent Studio operator', () => {
  it('is read-only by default and reports only bounded reviewed invariants', async () => {
    const gateway = new CellGateway()
    const result = await operateSophiaClusterAgentStudio(gateway, {
      runtimeBundleDigest: runtimeDigest,
    })

    expect(gateway.writes).toEqual([])
    expect(result.writes).toBe('none')
    expect(result.candidate).toMatchObject({
      registeredName: SOPHIA_1_RESIDENT_IDENTITY.registeredName,
      agentId: SOPHIA_CLUSTER_LEAD_HARNESS.agentId,
      runtimeBundleDigest: runtimeDigest,
      toolCount: SOPHIA_CLUSTER_AGENT_STUDIO_TOOL_COUNT,
    })
    expect(JSON.stringify(result)).not.toContain(owner)
    expect(result.coordinates.ownerPrincipalDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(gateway.bindings).toEqual([
      { graphId: 'sophia-cluster', owner },
      { graphId: 'observatory', owner },
    ])
  })

  it('detects a profile revision conflict inside AgentStudioApi before writing', async () => {
    const gateway = new CellGateway()
    const inspected = await inspect(gateway)
    gateway.profileReads = 0
    gateway.conflictOnSecondProfileRead = true

    await expect(operateSophiaClusterAgentStudio(gateway, {
      action: 'save',
      runtimeBundleDigest: runtimeDigest,
      confirmation: {
        profileDigest: inspected.candidate.digest,
        profileRevision: inspected.liveProfile.revision!,
      },
    })).rejects.toThrow(/changed in Garden/)
    expect(gateway.writes).toEqual([])
  })

  it('keeps Save draft-only and requires a separate confirmed Publish', async () => {
    const drifted = { ...profile, displayName: 'Old reviewed draft' }
    const gateway = new CellGateway(drifted)
    const beforeSave = await inspect(gateway)
    const saved = await operateSophiaClusterAgentStudio(gateway, {
      action: 'save',
      runtimeBundleDigest: runtimeDigest,
      confirmation: {
        profileDigest: beforeSave.candidate.digest,
        profileRevision: beforeSave.liveProfile.revision!,
      },
    })

    expect(saved.writes).toBe('draft-only')
    expect(gateway.writes).toEqual([{ graphId: 'sophia-cluster', documentId: 'agent-studio-profile' }])
    expect(gateway.documents.has(key('sophia-cluster', 'domain-agent-definition'))).toBe(false)

    const beforePublish = await inspect(gateway)
    const published = await operateSophiaClusterAgentStudio(gateway, {
      action: 'publish',
      runtimeBundleDigest: runtimeDigest,
      confirmation: {
        profileDigest: beforePublish.candidate.digest,
        profileRevision: beforePublish.liveProfile.revision!,
        activeDefinitionRevision: 'absent',
      },
      now: () => 1_800_000_000_000,
    })

    expect(published.writes).toBe('publication')
    expect(gateway.writes.at(-1)).toEqual({
      graphId: 'sophia-cluster',
      documentId: 'domain-agent-definition',
    })
    expect(published.publication?.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(published.previousActiveDefinition).toEqual({ revision: null, digest: null })

    const beforeRepublish = await inspect(gateway)
    const republished = await operateSophiaClusterAgentStudio(gateway, {
      action: 'publish',
      runtimeBundleDigest: runtimeDigest,
      confirmation: {
        profileDigest: beforeRepublish.candidate.digest,
        profileRevision: beforeRepublish.liveProfile.revision!,
        activeDefinitionRevision: beforeRepublish.resultingActiveDefinition.revision!,
      },
      now: () => 1_800_000_000_001,
    })
    expect(republished.previousActiveDefinition).toEqual(beforeRepublish.resultingActiveDefinition)
    expect(republished.invariants.previousActiveRetainedByRevision).toBe(true)
  })

  it('refuses to invent owner authority', async () => {
    const gateway = new CellGateway()
    gateway.graphRows = [graph('sophia-cluster')]
    await expect(inspect(gateway)).rejects.toThrow(/exactly one owner-bound 'observatory'/)
    expect(gateway.writes).toEqual([])
  })
})

async function inspect(gateway: CellGateway) {
  return operateSophiaClusterAgentStudio(gateway, {
    action: 'inspect',
    runtimeBundleDigest: runtimeDigest,
  })
}

function graph(graphId: string): GatewayGraphInfo {
  return { graphId, owner, title: graphId, role: 'owner', cellState: 'running' }
}

function key(graphId: string, documentId: string): string {
  return `${graphId}\0${documentId}`
}
