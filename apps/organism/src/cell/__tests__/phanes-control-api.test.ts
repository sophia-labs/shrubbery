import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  draftDiscordIngestionPolicy,
  createIngestionRunRequest,
  draftOperationsControl,
  parseAndValidateChannelCatalog,
  parseAndValidateControlBundle,
  parseAndValidateIngestionPolicy,
  parseAndValidateOperationsControl,
  sealControlBundle,
  sealDiscordIngestionPolicy,
  sealOperationsControl,
  type PhanesControlBundle,
  type PhanesDiscordChannelCatalog,
  type PhanesDiscordIngestionPolicy,
  type PhanesOperationsControl,
} from '../phanes-control-api.js'

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`

function draftBundle(): PhanesControlBundle {
  return {
    schema: 'sophia.agent-interaction-control-bundle.v1',
    object: {
      kind: 'agent-interaction-control-bundle',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:interaction-control',
      version: ZERO_DIGEST,
    },
    agent: {
      kind: 'agent',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad',
    },
    publishedAt: '2026-08-08T00:00:00Z',
    presentation: {
      schema: 'sophia.agent-presentation-catalog.v1',
      object: {
        kind: 'agent-presentation-catalog',
        objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:presentation',
      },
      messages: [
        {
          schema: 'sophia.message-template.v1',
          object: {
            kind: 'message-template',
            objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:message-template:flow.root.title',
            version: ZERO_DIGEST,
          },
          key: 'flow.root.title',
          text: 'Hello',
          surface: 'embed-title',
          description: 'Flow title',
          allowedVariables: [],
          maxLength: 256,
        },
        {
          schema: 'sophia.message-template.v1',
          object: {
            kind: 'message-template',
            objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:message-template:flow.root.body',
            version: ZERO_DIGEST,
          },
          key: 'flow.root.body',
          text: 'Choose what Phanes should do.',
          surface: 'embed-body',
          description: 'Flow body',
          allowedVariables: [],
          maxLength: 4096,
        },
        {
          schema: 'sophia.message-template.v1',
          object: {
            kind: 'message-template',
            objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:message-template:flow.roles.manage',
            version: ZERO_DIGEST,
          },
          key: 'flow.roles.manage',
          text: 'Choose roles',
          surface: 'button',
          description: 'Roles action',
          allowedVariables: [],
          maxLength: 80,
        },
      ],
    },
    flows: [
      {
        schema: 'sophia.interaction-flow.v1',
        object: {
          kind: 'interaction-flow',
          objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:interaction-flow:phanes-hub',
          version: ZERO_DIGEST,
        },
        flowId: 'phanes-hub',
        entryNode: 'root',
        nodes: [
          {
            nodeId: 'root',
            kind: 'menu',
            titleTemplate: 'flow.root.title',
            bodyTemplate: 'flow.root.body',
            actions: [],
          },
        ],
      },
      {
        schema: 'sophia.interaction-flow.v1',
        object: {
          kind: 'interaction-flow',
          objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:interaction-flow:roles-hub',
          version: ZERO_DIGEST,
        },
        flowId: 'roles-hub',
        entryNode: 'roles',
        nodes: [
          {
            nodeId: 'roles',
            kind: 'roles',
            titleTemplate: 'flow.root.title',
            bodyTemplate: 'flow.root.body',
            actions: [
              {
                actionId: 'manage',
                kind: 'roles.manage',
                labelTemplate: 'flow.roles.manage',
                style: 'primary',
                target: null,
                requiredCog: 'Roles',
              },
            ],
          },
        ],
      },
    ],
  }
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function channelCatalog(): Promise<PhanesDiscordChannelCatalog> {
  const objectRoot = 'urn:sophia:agent:agent-ded0c28b107012ad:discord-channel-catalog'
  const channel = {
    schema: 'sophia.discord-channel.v1',
    object: {
      kind: 'discord-channel',
      objectId: `${objectRoot}:channel:200`,
      version: ZERO_DIGEST,
    },
    channelId: '200',
    name: 'bots',
    kind: 'text',
    categoryName: 'Garden',
  }
  channel.object.version = await digest({
    channelId: channel.channelId,
    name: channel.name,
    kind: channel.kind,
    categoryName: channel.categoryName,
  })
  const catalog: PhanesDiscordChannelCatalog = {
    schema: 'sophia.discord-channel-catalog.v1',
    object: {
      kind: 'discord-channel-catalog',
      objectId: objectRoot,
      version: ZERO_DIGEST,
    },
    guildId: '100',
    channels: [channel],
    observedAt: '2026-08-08T12:00:00Z',
    source: 'discord-gateway-cache-no-message-polling',
  }
  catalog.object.version = await digest({
    guildId: catalog.guildId,
    channels: catalog.channels,
    observedAt: catalog.observedAt,
    source: catalog.source,
  })
  return catalog
}

function policyDraft(): PhanesDiscordIngestionPolicy {
  return {
    schema: 'sophia.discord-ingestion-policy.v1',
    object: {
      kind: 'discord-ingestion-policy',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:discord-ingestion-policy',
      version: ZERO_DIGEST,
    },
    guildId: '100',
    enabled: false,
    excludedChannels: [],
    semantics: {
      configuredFence: 'runtime-configured-narrow-only',
      discordMutation: 'forbidden',
      excludedChannel: {
        initialBackfill: 'never-read',
        gatewayCreate: 'ignore',
        gatewayEdit: 'ignore',
        gatewayDelete: 'ignore',
        directMention: 'ignore',
        capabilityContext: 'deny',
      },
      policyChange: 'rdf-source-surgery-and-rematerialization',
    },
    updatedAt: '2026-08-08T12:00:00Z',
  }
}

function operationsDraft(): PhanesOperationsControl {
  return {
    schema: 'sophia.agent-operations-control.v1',
    object: {
      kind: 'agent-operations-control',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:operations-control',
      version: ZERO_DIGEST,
    },
    agent: { kind: 'agent', objectId: 'urn:sophia:agent:agent-ded0c28b107012ad' },
    responsesEnabled: true,
    ingestionRequest: null,
    updatedAt: '2026-08-08T12:00:00Z',
  }
}

describe('Phanes control Meaningful Object contract', () => {
  it('uses the same code-point key ordering as the Python runtime', () => {
    expect(canonicalJson({ a: 1, B: 2 })).toBe('{"B":2,"a":1}')
  })

  it('seals and rereads a canonical AgentPresentationCatalog and InteractionFlow', async () => {
    const sealed = await sealControlBundle(draftBundle())
    const canonical = canonicalJson(sealed)
    const reread = await parseAndValidateControlBundle(canonical)

    expect(reread).toEqual(sealed)
    expect(sealed.object.version).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(sealed.presentation.messages[0].object.version).not.toBe(ZERO_DIGEST)
    expect(sealed.flows[0].object.version).not.toBe(ZERO_DIGEST)
  })

  it('rejects copy and behavior outside the Discord host capability boundary', async () => {
    const invalidSurface = draftBundle()
    invalidSurface.presentation.messages[0].surface = 'arbitrary-html'
    await expect(sealControlBundle(invalidSurface)).rejects.toThrow('surface the host does not admit')

    const missingHostFlow = draftBundle()
    missingHostFlow.flows[0].flowId = 'alternate'
    missingHostFlow.flows[0].object.objectId = (
      'urn:sophia:agent:agent-ded0c28b107012ad:interaction-flow:alternate'
    )
    await expect(sealControlBundle(missingHostFlow)).rejects.toThrow('host Phanes interaction flow')

    const missingRolesFlow = draftBundle()
    missingRolesFlow.flows = missingRolesFlow.flows.filter(flow => flow.flowId !== 'roles-hub')
    await expect(sealControlBundle(missingRolesFlow)).rejects.toThrow('host Roles interaction flow')

    const nestedRoles = draftBundle()
    nestedRoles.flows[0].nodes[0].actions.push({
      actionId: 'roles',
      kind: 'roles.manage',
      labelTemplate: 'flow.roles.manage',
      style: 'primary',
      target: null,
      requiredCog: 'Roles',
    })
    await expect(sealControlBundle(nestedRoles)).rejects.toThrow('outside the Phanes interaction flow')

    const unsafeTemplate = draftBundle()
    unsafeTemplate.presentation.messages[0].text = 'Hello {Nickname}'
    unsafeTemplate.presentation.messages[0].allowedVariables = ['Nickname']
    await expect(sealControlBundle(unsafeTemplate)).rejects.toThrow('template variable is unsafe')

    const invalidAction = draftBundle()
    invalidAction.flows[0].nodes[0].actions.push({
      actionId: 'shell',
      kind: 'host.shell',
      labelTemplate: 'flow.root.title',
      style: 'danger',
      target: null,
      requiredCog: null,
    })
    await expect(sealControlBundle(invalidAction)).rejects.toThrow('capability the host does not admit')
  })

  it('rejects stale Meaningful Object digests after an out-of-band edit', async () => {
    const sealed = await sealControlBundle(draftBundle())
    sealed.presentation.messages[0].text = 'Tampered'
    sealed.presentation.messages[0].allowedVariables = []

    await expect(parseAndValidateControlBundle(canonicalJson(sealed))).rejects.toThrow('stale content digest')
  })
})

describe('Phanes Discord ingestion Meaningful Objects', () => {
  it('rereads the bot-authored cache-only channel catalog and owner-authored policy', async () => {
    const catalog = await channelCatalog()
    const rereadCatalog = await parseAndValidateChannelCatalog(canonicalJson(catalog))
    expect(rereadCatalog).toEqual(catalog)

    const excluded = draftDiscordIngestionPolicy(policyDraft(), {
      enabled: true,
      excludedChannelIds: ['200'],
    })
    const sealed = await sealDiscordIngestionPolicy(excluded, catalog)
    const rereadPolicy = await parseAndValidateIngestionPolicy(canonicalJson(sealed))

    expect(rereadPolicy).toEqual(sealed)
    expect(sealed.enabled).toBe(true)
    expect(sealed.excludedChannels.map(item => item.channelId)).toEqual(['200'])
    expect(sealed.object.version).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(sealed.semantics.discordMutation).toBe('forbidden')
  })

  it('rejects exclusions outside the bot-authored configured fence', async () => {
    const catalog = await channelCatalog()
    const escaped = draftDiscordIngestionPolicy(policyDraft(), {
      enabled: true,
      excludedChannelIds: ['999'],
    })

    await expect(sealDiscordIngestionPolicy(escaped, catalog)).rejects.toThrow('only narrow')
  })

  it('rejects stale nested channel and exclusion testimony', async () => {
    const catalog = await channelCatalog()
    catalog.channels[0].name = 'tampered'
    await expect(parseAndValidateChannelCatalog(canonicalJson(catalog))).rejects.toThrow('stale content digest')

    const freshCatalog = await channelCatalog()
    const policy = await sealDiscordIngestionPolicy(
      draftDiscordIngestionPolicy(policyDraft(), {
        enabled: true,
        excludedChannelIds: ['200'],
      }),
      freshCatalog,
    )
    policy.excludedChannels[0].object.version = ZERO_DIGEST
    await expect(parseAndValidateIngestionPolicy(canonicalJson(policy))).rejects.toThrow('stale content digest')
  })
})

describe('Phanes operational Meaningful Objects', () => {
  it('seals the response switch and a one-shot current-policy reconciliation request', async () => {
    const request = createIngestionRunRequest(
      '12345678-1234-4123-8123-123456789abc',
      '2026-08-08T18:00:00Z',
    )
    const sealed = await sealOperationsControl(draftOperationsControl(operationsDraft(), {
      responsesEnabled: false,
      ingestionRequest: request,
    }))
    const reread = await parseAndValidateOperationsControl(canonicalJson(sealed))

    expect(reread).toEqual(sealed)
    expect(reread.responsesEnabled).toBe(false)
    expect(reread.ingestionRequest?.intent).toBe('reconcile-current-policy')
    expect(reread.ingestionRequest?.discordMutation).toBe('forbidden')
    expect(reread.ingestionRequest?.object.version).not.toBe(ZERO_DIGEST)
  })
})
