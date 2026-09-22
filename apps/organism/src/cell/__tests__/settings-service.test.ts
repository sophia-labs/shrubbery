import { describe, expect, it } from 'vitest'
import {
  createDefaultSettingsService,
  persistAppearancePreferences,
  readAppearancePreferences,
  readEditorMaterialPreference,
  resolveThemePreference,
} from '../settings-service.js'
import { PhanesControlApi } from '../phanes-control-api.js'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('DefaultOrganismSettingsService', () => {
  it('publishes the shell-owned Phanes workbench only when cross-graph authority exists', async () => {
    const phanesControl = new PhanesControlApi({
      async callTool() { throw new Error('not called while projecting settings') },
    })
    const service = createDefaultSettingsService({
      runtimeMode: 'hosted',
      phanesControl,
    })

    const phanes = (await service.load()).sections.find(section => section.id === 'phanes')
    expect(service.phanesControl).toBe(phanesControl)
    expect(phanes).toMatchObject({
      id: 'phanes',
      wide: true,
      contentSlot: 'phanes-control',
    })
    expect(phanes?.description).toContain('standalone /phanes and /roles')
  })

  it('publishes only settings backed by this runtime instead of disabled placeholders', async () => {
    const service = createDefaultSettingsService({
      runtimeMode: 'hosted',
      userName: 'Vera',
      userEmail: 'vera@example.test',
      apiBaseUrl: 'https://api.example.test',
      mcpUrl: 'https://api.example.test/g/graph/mcp',
    })
    const snapshot = await service.load()
    expect(snapshot.userEmail).toBe('vera@example.test')
    expect(snapshot.sections.map(section => section.id)).toEqual([
      'account', 'appearance', 'interface', 'api-mcp',
    ])
    expect(snapshot.sections.flatMap(section => [
      ...(section.toggles ?? []).map(setting => setting.id),
      ...(section.selects ?? []).map(setting => setting.id),
    ])).not.toEqual(expect.arrayContaining(['density', 'restoreLastDocument', 'autoSync']))
    expect(snapshot.sections.find(section => section.id === 'api-mcp')?.metrics).toEqual([
      { id: 'api-base', label: 'API base', value: 'https://api.example.test' },
      { id: 'mcp-url', label: 'MCP endpoint', value: 'https://api.example.test/g/graph/mcp' },
    ])
    expect(snapshot.sections.flatMap(section => section.actions ?? [])).toEqual([])
  })

  it('persists controlled toggle/select changes and reflects them after reload', async () => {
    const storage = new MemoryStorage()
    const service = createDefaultSettingsService({ runtimeMode: 'local', storage })
    await service.toggle({ sectionId: 'appearance', settingId: 'reducedMotion', checked: true })
    await service.select({ sectionId: 'appearance', settingId: 'editorMaterial', value: 'classic-word' })
    await service.select({ sectionId: 'appearance', settingId: 'theme', value: 'dark' })
    const snapshot = await service.load()
    const appearance = snapshot.sections.find(section => section.id === 'appearance')!
    expect(appearance.toggles?.find(toggle => toggle.id === 'reducedMotion')?.checked).toBe(true)
    expect(appearance.selects?.find(select => select.id === 'editorMaterial')?.value).toBe('classic-word')
    expect(appearance.selects?.find(select => select.id === 'theme')?.value).toBe('dark')
    expect(readEditorMaterialPreference(storage)).toBe('classic-word')
    expect(storage.values.size).toBe(1)

    await service.select({ sectionId: 'appearance', settingId: 'editorMaterial', value: 'continuous' })
    expect(readEditorMaterialPreference(storage)).toBe('continuous')
  })

  it('publishes and persists the shared Garden, Sophia, 98, and Glass identity cycle', async () => {
    const storage = new MemoryStorage()
    const service = createDefaultSettingsService({ runtimeMode: 'local', storage })
    const initial = await service.load()
    const skin = initial.sections.find(section => section.id === 'appearance')
      ?.selects?.find(select => select.id === 'skin')
    expect(skin?.options).toEqual([
      { value: 'garden', label: 'Garden' },
      { value: 'emporium', label: 'Sophia' },
      { value: '98', label: '98' },
      { value: 'glass', label: 'Glass' },
    ])

    await service.select({ sectionId: 'appearance', settingId: 'skin', value: '98' })
    expect(readAppearancePreferences(storage)).toEqual({ skin: '98', theme: 'system' })
    expect((await service.load()).sections.find(section => section.id === 'appearance')
      ?.selects?.find(select => select.id === 'skin')?.value).toBe('98')

    persistAppearancePreferences(storage, { skin: 'emporium', theme: 'dark' })
    expect(readAppearancePreferences(storage)).toEqual({ skin: 'emporium', theme: 'dark' })
    expect(resolveThemePreference('system', true)).toBe('dark')
    expect(resolveThemePreference('system', false)).toBe('light')
  })

  it('migrates the former Sophia spelling and overwrites unknown stored identities', () => {
    const storage = new MemoryStorage()
    storage.setItem('shrubbery.organism.settings.v1', JSON.stringify({ skin: 'sophia' }))
    expect(readAppearancePreferences(storage).skin).toBe('emporium')
    storage.setItem('shrubbery.organism.settings.v1', JSON.stringify({ skin: 'not-a-skin' }))
    expect(readAppearancePreferences(storage).skin).toBe('garden')
    expect(JSON.parse(storage.getItem('shrubbery.organism.settings.v1') ?? '{}').skin).toBe('garden')
  })

  it('migrates the former paperPage boolean without losing an opted-in page', async () => {
    const storage = new MemoryStorage()
    storage.setItem('shrubbery.organism.settings.v1', JSON.stringify({ paperPage: true }))
    expect(readEditorMaterialPreference(storage)).toBe('paper')
    const snapshot = await createDefaultSettingsService({ runtimeMode: 'local', storage }).load()
    const material = snapshot.sections.find(section => section.id === 'appearance')
      ?.selects?.find(select => select.id === 'editorMaterial')
    expect(material?.value).toBe('paper')
  })

  it('configures and deletes native provider keys without exposing their values in rows', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
    let configured = false
    const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      calls.push({ command, args })
      if (command === 'provider_key_status') return { openrouter: configured } as T
      if (command === 'store_provider_key') configured = true
      if (command === 'delete_provider_key') configured = false
      return undefined as T
    }
    const service = createDefaultSettingsService({
      runtimeMode: 'local',
      invoke,
      promptSecret: () => 'sk-secret-value',
    })
    await service.secret({ sectionId: 'local-ai', secretId: 'openrouter', action: 'configure' })
    let snapshot = await service.load()
    expect(snapshot.sections.find(section => section.id === 'api-keys')).toBeUndefined()
    expect(snapshot.sections.find(section => section.id === 'local-ai')?.title).toBe('Local AI')
    expect(snapshot.sections.find(section => section.id === 'local-ai')?.secrets?.[0].configured).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('sk-secret-value')
    expect(calls).toContainEqual({
      command: 'store_provider_key',
      args: { provider: 'openrouter', apiKey: 'sk-secret-value' },
    })

    await service.secret({ sectionId: 'local-ai', secretId: 'openrouter', action: 'delete' })
    snapshot = await service.load()
    expect(snapshot.sections.find(section => section.id === 'local-ai')?.secrets?.[0].configured).toBe(false)
  })

  it('projects a hosted Choreograph credential store as account-scoped OpenRouter only', async () => {
    let configured = false
    const writes: string[] = []
    const service = createDefaultSettingsService({
      runtimeMode: 'hosted',
      apiBaseUrl: 'https://api.example.test/g/graph-a',
      mcpUrl: 'https://api.example.test/g/graph-a/mcp',
      providerSecrets: {
        providers: ['openrouter'],
        storageLabel: 'Choreograph account secret store',
        async status() { return { openrouter: configured } },
        async store(provider, secret) {
          expect(provider).toBe('openrouter')
          writes.push(secret)
          configured = true
        },
        async delete(provider) {
          expect(provider).toBe('openrouter')
          configured = false
        },
      },
      promptSecret: () => 'hosted-sentinel-secret',
    })

    let snapshot = await service.load()
    expect(snapshot.sections.map(section => section.id)).toEqual([
      'account', 'appearance', 'interface', 'api-keys', 'api-mcp',
    ])
    expect(snapshot.sections.find(section => section.id === 'local-ai')).toBeUndefined()
    expect(snapshot.sections.find(section => section.id === 'api-keys')?.secrets?.map(secret => secret.id)).toEqual(['openrouter'])

    await service.secret({ sectionId: 'api-keys', secretId: 'openrouter', action: 'configure' })
    snapshot = await service.load()
    expect(snapshot.sections.find(section => section.id === 'api-keys')?.secrets?.[0].configured).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('hosted-sentinel-secret')
    expect(writes).toEqual(['hosted-sentinel-secret'])

    await service.secret({ sectionId: 'api-keys', secretId: 'openrouter', action: 'delete' })
    snapshot = await service.load()
    expect(snapshot.sections.find(section => section.id === 'api-keys')?.secrets?.[0].configured).toBe(false)
  })
})
