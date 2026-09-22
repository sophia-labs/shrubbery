import { describe, expect, it, vi } from 'vitest'
import '../phanes-control-editor.js'
import {
  canonicalJson,
  type PhanesControlApi,
  type PhanesControlBundle,
  type PhanesControlDocument,
  type PhanesDiscordIngestionControl,
  type PhanesDiscordIngestionPolicy,
  type PhanesOperations,
  type PhanesOperationsControl,
} from '../phanes-control-api.js'
import type { MnPhanesControlEditor } from '../phanes-control-editor.js'

const VERSION = `sha256:${'0'.repeat(64)}`

function controlBundle(): PhanesControlBundle {
  const message = (key: string, text: string, surface = 'message') => ({
    schema: 'sophia.message-template.v1',
    object: {
      kind: 'message-template',
      objectId: `urn:sophia:agent:agent-ded0c28b107012ad:message-template:${key}`,
      version: VERSION,
    },
    key,
    text,
    surface,
    description: key,
    allowedVariables: [] as string[],
    maxLength: 4096,
  })
  return {
    schema: 'sophia.agent-interaction-control-bundle.v1',
    object: {
      kind: 'agent-interaction-control-bundle',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:interaction-control',
      version: VERSION,
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
        message('command.phanes.description', 'Open Phanes', 'command-description'),
        message('command.roles.description', 'Open roles', 'command-description'),
        message('flow.root.title', 'Choose a privacy mode', 'embed-title'),
      ],
    },
    flows: [
      {
        schema: 'sophia.interaction-flow.v1',
        object: {
          kind: 'interaction-flow',
          objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:interaction-flow:phanes-hub',
          version: VERSION,
        },
        flowId: 'phanes-hub',
        entryNode: 'root',
        nodes: [{
          nodeId: 'root',
          kind: 'privacy',
          titleTemplate: 'flow.root.title',
          bodyTemplate: 'flow.root.title',
          actions: [{
            actionId: 'superphan',
            kind: 'privacy.superphan',
            labelTemplate: 'flow.root.title',
            style: 'primary',
            target: null,
            requiredCog: 'Privacy',
          }],
        }],
      },
      {
        schema: 'sophia.interaction-flow.v1',
        object: {
          kind: 'interaction-flow',
          objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:interaction-flow:roles-hub',
          version: VERSION,
        },
        flowId: 'roles-hub',
        entryNode: 'roles',
        nodes: [{
          nodeId: 'roles',
          kind: 'roles',
          titleTemplate: 'flow.root.title',
          bodyTemplate: 'flow.root.title',
          actions: [{
            actionId: 'manage',
            kind: 'roles.manage',
            labelTemplate: 'flow.root.title',
            style: 'primary',
            target: null,
            requiredCog: 'Roles',
          }],
        }],
      },
    ],
  }
}

function controlDocument(): PhanesControlDocument {
  const bundle = controlBundle()
  return {
    bundle,
    revision: 7,
    canonicalContent: canonicalJson(bundle),
    updatedAt: '2026-08-08T00:00:00Z',
  }
}

function ingestionControl(): PhanesDiscordIngestionControl {
  const semantics: PhanesDiscordIngestionPolicy['semantics'] = {
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
  }
  const policy: PhanesDiscordIngestionPolicy = {
    schema: 'sophia.discord-ingestion-policy.v1',
    object: {
      kind: 'discord-ingestion-policy',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:discord-ingestion-policy',
      version: VERSION,
    },
    guildId: '100',
    enabled: false,
    excludedChannels: [],
    semantics,
    updatedAt: '2026-08-08T00:00:00Z',
  }
  const catalog = {
    schema: 'sophia.discord-channel-catalog.v1',
    object: {
      kind: 'discord-channel-catalog',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:discord-channel-catalog',
      version: VERSION,
    },
    guildId: '100',
    channels: [{
      schema: 'sophia.discord-channel.v1',
      object: {
        kind: 'discord-channel',
        objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:discord-channel-catalog:channel:200',
        version: VERSION,
      },
      channelId: '200',
      name: 'bots',
      kind: 'text',
      categoryName: 'Garden',
    }],
    observedAt: '2026-08-08T00:00:00Z',
    source: 'discord-gateway-cache-no-message-polling',
  }
  return {
    catalog: {
      value: catalog,
      revision: 3,
      canonicalContent: canonicalJson(catalog),
      updatedAt: '2026-08-08T00:00:00Z',
    },
    policy: {
      value: policy,
      revision: 4,
      canonicalContent: canonicalJson(policy),
      updatedAt: '2026-08-08T00:00:00Z',
    },
  }
}

function operationsControl(): PhanesOperations {
  const control: PhanesOperationsControl = {
    schema: 'sophia.agent-operations-control.v1',
    object: {
      kind: 'agent-operations-control',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:operations-control',
      version: VERSION,
    },
    agent: { kind: 'agent', objectId: 'urn:sophia:agent:agent-ded0c28b107012ad' },
    responsesEnabled: true,
    ingestionRequest: null,
    updatedAt: '2026-08-08T00:00:00Z',
  }
  const status = {
    schema: 'sophia.agent-operations-status.v1',
    object: {
      kind: 'agent-operations-status',
      objectId: 'urn:sophia:agent:agent-ded0c28b107012ad:operations-status',
      version: VERSION,
    },
    agent: { kind: 'agent' as const, objectId: 'urn:sophia:agent:agent-ded0c28b107012ad' },
    source: 'phanes-runtime-privacy-authority' as const,
    responsesEnabled: true,
    controlVersion: VERSION,
    ingestion: {
      phase: 'active',
      controlRequestId: null,
      privacyRequestId: null,
      authorityRevision: 3,
      messageCount: 42,
      documentCount: 1,
      errorCode: null,
    },
    updatedAt: '2026-08-08T00:00:00Z',
  }
  return {
    control: { value: control, revision: 5, canonicalContent: canonicalJson(control), updatedAt: control.updatedAt },
    status: { value: status, revision: 6, canonicalContent: canonicalJson(status), updatedAt: status.updatedAt },
  }
}

async function settle(editor: MnPhanesControlEditor): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await editor.updateComplete
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await editor.updateComplete
}

function button(editor: MnPhanesControlEditor, label: string): HTMLButtonElement {
  const candidate = [...editor.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')]
    .find(element => element.textContent?.includes(label))
  if (!candidate) throw new Error(`Missing button ${label}`)
  return candidate
}

describe('mn-phanes-control-editor', () => {
  it('edits every message and presents /roles as a separate top-level flow', async () => {
    const control = controlDocument()
    const save = vi.fn(async (candidate: unknown) => ({
      ...control,
      bundle: candidate as PhanesControlBundle,
      canonicalContent: canonicalJson(candidate),
    }))
    const api = {
      load: vi.fn(async () => control),
      loadIngestionControl: vi.fn(async () => ingestionControl()),
      loadOperations: vi.fn(async () => operationsControl()),
      save,
      saveIngestionPolicy: vi.fn(),
    } as unknown as PhanesControlApi
    const editor = document.createElement('mn-phanes-control-editor')
    editor.api = api
    document.body.appendChild(editor)
    await settle(editor)

    button(editor, 'Message copy').click()
    await editor.updateComplete

    const copyEditors = editor.shadowRoot!.querySelectorAll<HTMLTextAreaElement>('.message-card textarea')
    expect(copyEditors).toHaveLength(control.bundle.presentation.messages.length)
    for (const field of copyEditors) expect(field.disabled).toBe(false)
    copyEditors[0]!.value = 'Open the Phanes garden'
    copyEditors[0]!.dispatchEvent(new Event('input', { bubbles: true }))
    await editor.updateComplete
    button(editor, 'Publish revision').click()
    await settle(editor)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ key: 'command.phanes.description', text: 'Open the Phanes garden' }),
          ]),
        }),
      }),
      7,
    )

    button(editor, 'Flow & raw JSON').click()
    await editor.updateComplete
    const cards = [...editor.shadowRoot!.querySelectorAll<HTMLElement>('.flow-card')]
    expect(cards.map(card => card.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('phanes-hub / root'),
      expect.stringContaining('roles-hub / roles'),
    ]))
    expect(cards.find(card => card.textContent?.includes('phanes-hub'))?.textContent).not.toContain('roles.manage')
    editor.remove()
  })

  it('publishes a channel exclusion without any Discord mutation surface', async () => {
    const ingestion = ingestionControl()
    const saveIngestionPolicy = vi.fn(async (value: PhanesDiscordIngestionPolicy) => ({
      ...ingestion,
      policy: {
        ...ingestion.policy,
        value,
        canonicalContent: canonicalJson(value),
      },
    }))
    const api = {
      load: vi.fn(async () => controlDocument()),
      loadIngestionControl: vi.fn(async () => ingestion),
      loadOperations: vi.fn(async () => operationsControl()),
      save: vi.fn(),
      saveIngestionPolicy,
    } as unknown as PhanesControlApi
    const editor = document.createElement('mn-phanes-control-editor')
    editor.api = api
    document.body.appendChild(editor)
    await settle(editor)

    button(editor, 'Channel ingestion').click()
    await editor.updateComplete
    const toggles = editor.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(toggles).toHaveLength(2)
    toggles[1]!.checked = false
    toggles[1]!.dispatchEvent(new Event('change', { bubbles: true }))
    await editor.updateComplete
    button(editor, 'Publish ingestion policy').click()
    await settle(editor)

    expect(saveIngestionPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        semantics: expect.objectContaining({ discordMutation: 'forbidden' }),
        excludedChannels: [expect.objectContaining({ channelId: '200' })],
      }),
      4,
    )
    expect(editor.shadowRoot!.textContent).toContain('It never deletes or edits Discord data.')
    editor.remove()
  })

  it('toggles replies and requests ingestion from the runtime operations surface', async () => {
    const operations = operationsControl()
    const saveOperationsControl = vi.fn(async (value: PhanesOperationsControl) => ({
      ...operations,
      control: {
        ...operations.control,
        value,
        canonicalContent: canonicalJson(value),
      },
    }))
    const api = {
      load: vi.fn(async () => controlDocument()),
      loadIngestionControl: vi.fn(async () => ingestionControl()),
      loadOperations: vi.fn(async () => operations),
      save: vi.fn(),
      saveIngestionPolicy: vi.fn(),
      saveOperationsControl,
    } as unknown as PhanesControlApi
    const editor = document.createElement('mn-phanes-control-editor')
    editor.api = api
    document.body.appendChild(editor)
    await settle(editor)

    expect(editor.shadowRoot!.textContent).toContain('42')
    const responseToggle = editor.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    responseToggle.checked = false
    responseToggle.dispatchEvent(new Event('change', { bubbles: true }))
    await settle(editor)
    expect(saveOperationsControl).toHaveBeenCalledWith(expect.objectContaining({ responsesEnabled: false }), 5)

    button(editor, 'Run ingestion now').click()
    await settle(editor)
    expect(saveOperationsControl).toHaveBeenLastCalledWith(expect.objectContaining({
      ingestionRequest: expect.objectContaining({
        intent: 'reconcile-current-policy',
        discordMutation: 'forbidden',
      }),
    }), 5)
    editor.remove()
  })
})
