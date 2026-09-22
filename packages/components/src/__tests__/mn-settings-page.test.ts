/**
 * Real component tests for the controlled Garden settings workbench.
 *
 * The element arranges caller-owned state and emits composed intents. It never
 * imports stores, native commands, auth, or a transport.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  MnSettingsPage,
  type MnSettingsActionDetail,
  type MnSettingsJobActionDetail,
  type MnSettingsSecretActionDetail,
  type MnSettingsSectionChangeDetail,
  type MnSettingsSelectChangeDetail,
  type MnSettingsToggleChangeDetail,
} from '../mn-settings-page.js'

async function mount(setup?: (el: MnSettingsPage) => void): Promise<MnSettingsPage> {
  const el = document.createElement('mn-settings-page') as MnSettingsPage
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnSettingsPage) => el.shadowRoot!

afterEach(() => document.body.replaceChildren())

describe('mn-settings-page - controlled Garden settings page', () => {
  beforeAll(() => {
    expect(customElements.get('mn-settings-page')).toBeDefined()
  })

  it('uses the shared Garden material hierarchy and keeps workspace navigation pinned', async () => {
    const el = await mount((node) => {
      node.sections = [{ id: 'account', title: 'Account' }]
    })
    const styles = (MnSettingsPage.styles as unknown as { cssText: string }).cssText

    expect(styles).toContain('height: var(--mn-top-bar-height, 40px)')
    expect(styles).toContain('border-bottom: 1px solid var(--mn-top-bar-border')
    expect(styles).toContain('background: var(--mn-color-surface-panel')
    expect(styles).toContain('background: var(--mn-color-surface-raised')
    expect(styles).toContain('box-shadow: var(--mn-shadow-card')
    expect(styles).toContain('width: 220px')
    expect(styles).toContain('max-width: 760px')
    expect(styles).toContain('max-width: 1200px')
    expect(styles).toContain('font-family: var(--mn-font-display')
    expect(sr(el).querySelector('.sidebar-footer .back-button')?.textContent).toContain('Back to workspace')
    expect(sr(el).querySelector('.header .button')).toBeNull()
    expect(sr(el).querySelector('.close[aria-label="Close settings"]')).not.toBeNull()
  })

  it('showClose=false (the leaf-mount case, wave1 review r1 WRONG fix) renders NEITHER close control — no dead affordance', async () => {
    const el = await mount((node) => {
      node.sections = [{ id: 'account', title: 'Account' }]
      node.showClose = false
    })
    expect(sr(el).querySelector('.back-button')).toBeNull()
    expect(sr(el).querySelector('.close[aria-label="Close settings"]')).toBeNull()
    expect(sr(el).querySelector('.sidebar-footer')).toBeNull()
  })

  it('composes settings as a study with section provenance and named ledgers', async () => {
    const el = await mount((node) => {
      node.activeSection = 'appearance'
      node.sections = [{
        id: 'appearance',
        title: 'Appearance',
        description: 'Skin, theme, and reading posture.',
        selects: [{
          id: 'skin',
          label: 'Skin',
          value: 'garden',
          options: [{ value: 'garden', label: 'Garden' }, { value: 'glass', label: 'Glass' }],
        }],
        toggles: [{ id: 'reducedMotion', label: 'Reduce motion', checked: false }],
      }]
    })

    const active = sr(el).querySelector('[data-section-id="appearance"]')!
    expect(active.getAttribute('aria-current')).toBe('page')
    expect(sr(el).querySelector('.section-kicker')?.textContent).toBe('Personal')
    expect(Array.from(sr(el).querySelectorAll('.panel-title')).map((title) => title.textContent)).toEqual([
      'Reading room',
      'Motion',
    ])
    expect(Array.from(sr(el).querySelectorAll('.panel-caption')).map((caption) => caption.textContent)).toEqual([
      'Theme, skin, and editor material.',
      'Tune movement without changing the visual identity.',
    ])
    expect(sr(el).querySelector('main')?.getAttribute('aria-labelledby')).toBe('settings-section-title')
  })

  it('renders loading/error states and exposes retry without a global refresh control', async () => {
    const el = await mount((node) => {
      node.status = 'loading'
    })
    expect(sr(el).querySelector('mn-loading')).not.toBeNull()
    expect(sr(el).querySelector('main')?.getAttribute('aria-busy')).toBe('true')
    expect(sr(el).querySelector('[data-state="loading"]')?.getAttribute('role')).toBe('status')

    let refreshes = 0
    el.addEventListener('mn-settings-refresh', () => { refreshes += 1 })
    el.status = 'error'
    el.error = 'settings read failed'
    await el.updateComplete

    const empty = sr(el).querySelector('mn-empty-state')!
    expect(empty.getAttribute('title')).toBe('Settings failed')
    expect(empty.getAttribute('description')).toBe('settings read failed')
    expect(sr(el).querySelector('[data-state="error"]')?.getAttribute('role')).toBe('alert')
    ;(sr(el).querySelector('.state-action') as HTMLButtonElement).click()
    expect(refreshes).toBe(1)
  })

  it('retains the last truthful section while a refresh is loading or fails', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.activeSection = 'interface'
      node.sections = [{
        id: 'interface',
        title: 'Interface',
        toggles: [{ id: 'panelLabels', label: 'Show panel labels', checked: true }],
      }]
    })

    expect(sr(el).querySelector('.section-title')?.textContent).toBe('Interface')
    el.status = 'loading'
    await el.updateComplete
    expect(sr(el).querySelector('.status-banner[data-tone="loading"]')?.textContent).toContain('Updating settings')
    expect(sr(el).querySelector('.section-title')?.textContent).toBe('Interface')
    expect(sr(el).querySelector('mn-loading')).toBeNull()

    let refreshes = 0
    el.addEventListener('mn-settings-refresh', () => { refreshes += 1 })
    el.status = 'error'
    el.error = 'Local runtime stopped responding'
    await el.updateComplete
    expect(sr(el).querySelector('.section-title')?.textContent).toBe('Interface')
    expect(sr(el).querySelector('.status-banner[data-tone="danger"]')?.textContent)
      .toContain('Local runtime stopped responding')
    ;(sr(el).querySelector('.status-banner .button') as HTMLButtonElement).click()
    expect(refreshes).toBe(1)
  })

  it('derives canonical navigation only from available sections and falls back to the first real section', async () => {
    const el = await mount((node) => {
      node.status = 'ready'
      node.activeSection = 'billing'
      node.sections = [
        { id: 'local-ai', title: 'Local AI' },
        { id: 'api-mcp', title: 'API & MCP' },
        { id: 'account', title: 'Account' },
      ]
    })
    const changes: MnSettingsSectionChangeDetail[] = []
    el.addEventListener('mn-settings-section-change', (event) => {
      changes.push((event as CustomEvent<MnSettingsSectionChangeDetail>).detail)
    })

    expect(el.activeSection).toBe('account')
    expect(Array.from(sr(el).querySelectorAll('.nav-item')).map((item) => item.getAttribute('data-section-id'))).toEqual([
      'account', 'api-mcp', 'local-ai',
    ])
    expect(sr(el).querySelector('[data-section-id="billing"]')).toBeNull()
    expect(Array.from(sr(el).querySelectorAll('.nav-label')).map((item) => item.textContent)).toEqual(['Personal', 'Integrations'])

    ;(sr(el).querySelector('[data-section-id="local-ai"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(changes).toEqual([{ sectionId: 'local-ai' }])
    expect(sr(el).querySelector('.section-title')?.textContent).toBe('Local AI')
  })

  it('does not select a hidden section or manufacture fallback settings copy', async () => {
    const el = await mount((node) => {
      node.activeSection = 'account'
      node.navGroups = [{
        label: 'Personal',
        items: [{ id: 'account', label: 'Account', hidden: true }],
      }]
      node.sections = [
        { id: 'account', title: 'Account' },
        { id: 'privacy', title: 'Privacy', toggles: [{ id: 'analytics', label: 'Analytics', checked: false }] },
      ]
    })

    expect(el.activeSection).toBe('privacy')
    expect(sr(el).querySelector('[data-section-id="account"]')).toBeNull()
    expect(sr(el).querySelector('.section-title')?.textContent).toBe('Privacy')
    expect(sr(el).textContent).not.toContain('registered, but no shell-owned rows')
  })

  it('renders supplied account identity and omits unavailable local sign-out', async () => {
    const el = await mount((node) => {
      node.userName = 'Ada Lovelace'
      node.userEmail = 'ada@garden.test'
      node.sections = [{
        id: 'account',
        title: 'Account',
        metrics: [{ id: 'runtime', label: 'Runtime', value: 'local' }],
        actions: [{ id: 'sign-out', label: 'Sign out', disabled: true, variant: 'danger' }],
      }]
    })

    expect(sr(el).querySelector('[data-identity="name"]')?.textContent).toBe('Ada Lovelace')
    expect(sr(el).querySelector('[data-identity="email"]')?.textContent).toBe('ada@garden.test')
    expect(sr(el).querySelector('[data-action-id="sign-out"]')).toBeNull()
    expect(sr(el).querySelector('.metric-value')?.textContent).toBe('local')
    expect(sr(el).querySelector('.identity-kind')?.textContent).toBe('Hosted account')

    el.userEmail = ''
    await el.updateComplete
    expect(sr(el).querySelector('[data-identity="email"]')).toBeNull()
    expect(sr(el).querySelector('.identity-row .field-label')?.textContent).toBe('Local profile')
    expect(sr(el).querySelector('[data-identity="name"]')?.textContent).toBe('Ada Lovelace')

    const actions: MnSettingsActionDetail[] = []
    el.addEventListener('mn-settings-action', (event) => {
      actions.push((event as CustomEvent<MnSettingsActionDetail>).detail)
    })
    el.sections = [{
      id: 'account',
      title: 'Account',
      actions: [{ id: 'sign-out', label: 'Sign out', variant: 'danger' }],
    }]
    await el.updateComplete
    ;(sr(el).querySelector('[data-action-id="sign-out"] .button') as HTMLButtonElement).click()
    expect(actions).toEqual([{ sectionId: 'account', actionId: 'sign-out' }])
  })

  it('renders applied preferences and emits toggle/select intents', async () => {
    const el = await mount((node) => {
      node.activeSection = 'appearance'
      node.sections = [{
        id: 'appearance',
        title: 'Appearance',
        description: 'Skin and posture',
        metrics: [{ id: 'skin', label: 'Skin', value: 'Sophia', detail: 'Light theme', tone: 'accent' }],
        toggles: [{ id: 'dark-mode', label: 'Dark Mode', checked: false }],
        selects: [{
          id: 'posture',
          label: 'Posture',
          value: 'comfortable',
          options: [
            { value: 'manuscript', label: 'Manuscript' },
            { value: 'comfortable', label: 'Comfortable' },
          ],
        }],
      }]
    })
    const toggles: MnSettingsToggleChangeDetail[] = []
    const selects: MnSettingsSelectChangeDetail[] = []
    el.addEventListener('mn-settings-toggle-change', (event) => {
      toggles.push((event as CustomEvent<MnSettingsToggleChangeDetail>).detail)
    })
    el.addEventListener('mn-settings-select-change', (event) => {
      selects.push((event as CustomEvent<MnSettingsSelectChangeDetail>).detail)
    })

    expect(sr(el).querySelector('.metric-value')?.textContent).toBe('Sophia')
    ;(sr(el).querySelector('.toggle') as HTMLButtonElement).click()
    const select = sr(el).querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('comfortable')
    select.value = 'manuscript'
    select.dispatchEvent(new Event('change', { bubbles: true, composed: true }))

    expect(toggles).toEqual([{ sectionId: 'appearance', settingId: 'dark-mode', checked: true }])
    expect(selects).toEqual([{ sectionId: 'appearance', settingId: 'posture', value: 'manuscript' }])
  })

  it('labels provider credentials clearly and emits configure/delete intents', async () => {
    const el = await mount((node) => {
      node.activeSection = 'api-keys'
      node.sections = [{
        id: 'api-keys',
        title: 'API Keys',
        secrets: [
          { id: 'openai', label: 'OpenAI', configured: true },
          { id: 'anthropic', label: 'Anthropic', configured: false },
        ],
      }]
    })
    const secrets: MnSettingsSecretActionDetail[] = []
    el.addEventListener('mn-settings-secret-action', (event) => {
      secrets.push((event as CustomEvent<MnSettingsSecretActionDetail>).detail)
    })

    expect(sr(el).querySelector('.section-title')?.textContent).toBe('AI Provider Keys')
    expect(sr(el).querySelector('[data-section-id="api-keys"]')?.textContent).toContain('AI Provider Keys')
    const openAi = sr(el).querySelector('[data-secret-id="openai"]')!
    const buttons = Array.from(openAi.querySelectorAll('button'))
    buttons.find((button) => button.textContent?.includes('Replace'))!.click()
    buttons.find((button) => button.textContent?.includes('Delete'))!.click()

    expect(secrets).toEqual([
      { sectionId: 'api-keys', secretId: 'openai', action: 'configure' },
      { sectionId: 'api-keys', secretId: 'openai', action: 'delete' },
    ])
  })

  it('presents importers, graph operations, history, and endpoints with their real action IDs', async () => {
    const actions: MnSettingsActionDetail[] = []
    const el = await mount((node) => {
      node.activeSection = 'imports'
      node.sections = [
        {
          id: 'imports',
          title: 'Imports',
          actions: [
            { id: 'import-files', label: 'Import files', description: 'Choose documents.' },
            { id: 'import-obsidian', label: 'Import Obsidian vault', description: 'Choose a vault ZIP.' },
          ],
          jobs: [{ id: 'import-files', label: 'Import files', status: 'running', progress: 37 }],
        },
        {
          id: 'graph-ops',
          title: 'Graph Ops',
          actions: [
            { id: 'duplicate-graph', label: 'Duplicate graph' },
            { id: 'export-graph', label: 'Export graph' },
            { id: 'import-graph', label: 'Import graph' },
          ],
        },
        {
          id: 'history',
          title: 'History',
          actions: [
            { id: 'refresh-history', label: 'Refresh graph history' },
            { id: 'create-restore-point', label: 'Create restore point' },
            { id: 'restore-point:rp-1', label: 'Restore “Before import”', description: 'July 10 · 3 documents', variant: 'danger' },
          ],
        },
        {
          id: 'api-mcp',
          title: 'API & MCP',
          metrics: [
            { id: 'api-base', label: 'API base', value: 'http://127.0.0.1:64535' },
            { id: 'mcp-url', label: 'MCP endpoint', value: '/mcp' },
          ],
          actions: [
            { id: 'copy-api-url', label: 'Copy API URL' },
            { id: 'copy-mcp-url', label: 'Copy MCP URL' },
          ],
        },
      ]
    })
    el.addEventListener('mn-settings-action', (event) => {
      actions.push((event as CustomEvent<MnSettingsActionDetail>).detail)
    })

    expect(sr(el).querySelectorAll('.importer-card')).toHaveLength(2)
    expect(sr(el).querySelector('[data-job-id="import-files"]')?.getAttribute('data-status')).toBe('running')
    expect(sr(el).querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('37')
    ;(sr(el).querySelector('[data-action-id="import-files"] .button') as HTMLButtonElement).click()

    ;(sr(el).querySelector('[data-section-id="graph-ops"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(sr(el).querySelectorAll('.graph-operation-card')).toHaveLength(3)
    expect(sr(el).querySelector('.context-card')).not.toBeNull()

    ;(sr(el).querySelector('[data-section-id="history"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(sr(el).querySelector('.timeline [data-action-id="restore-point:rp-1"]')).not.toBeNull()
    ;(sr(el).querySelector('[data-action-id="refresh-history"] .button') as HTMLButtonElement).click()

    ;(sr(el).querySelector('[data-section-id="api-mcp"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(Array.from(sr(el).querySelectorAll('.endpoint-card code')).map((code) => code.textContent)).toEqual([
      'http://127.0.0.1:64535', '/mcp',
    ])
    ;(sr(el).querySelector('[data-action-id="copy-mcp-url"] .button') as HTMLButtonElement).click()

    expect(actions).toEqual([
      { sectionId: 'imports', actionId: 'import-files' },
      { sectionId: 'history', actionId: 'refresh-history' },
      { sectionId: 'api-mcp', actionId: 'copy-mcp-url' },
    ])
  })

  it('renders Local AI runtime cards with accessible progress and emits job/action/close intents', async () => {
    const el = await mount((node) => {
      node.activeSection = 'local-ai'
      node.sections = [{
        id: 'local-ai',
        title: 'Local AI',
        wide: true,
        selects: [{
          id: 'batch-size',
          label: 'Embedding batch size',
          value: '4',
          options: [
            { value: '1', label: '1' },
            { value: '4', label: '4' },
            { value: '8', label: '8' },
          ],
        }],
        jobs: [{
          id: 'semantic-index',
          label: 'Semantic Index',
          status: 'running',
          detail: 'Refreshing graph-a',
          progress: 42,
          actionLabel: 'Cancel',
        }],
        actions: [{ id: 'prepare-model', label: 'Prepare Model', description: 'Download embedding model' }],
        notes: ['Model cache is device-local.'],
      }]
    })
    const jobs: MnSettingsJobActionDetail[] = []
    const actions: MnSettingsActionDetail[] = []
    let closes = 0
    el.addEventListener('mn-settings-job-action', (event) => {
      jobs.push((event as CustomEvent<MnSettingsJobActionDetail>).detail)
    })
    el.addEventListener('mn-settings-action', (event) => {
      actions.push((event as CustomEvent<MnSettingsActionDetail>).detail)
    })
    el.addEventListener('mn-settings-close', () => { closes += 1 })

    const job = sr(el).querySelector('[data-job-id="semantic-index"]')!
    expect((sr(el).querySelector('[data-setting-id="batch-size"] select') as HTMLSelectElement).value).toBe('4')
    expect(sr(el).querySelector('.local-ai-stack .feature-card')).toBeNull()
    expect(sr(el).querySelector('.local-ai-ledger')).toBeNull()
    expect(sr(el).querySelector('.local-ai-diagnostics')?.hasAttribute('open')).toBe(false)
    expect(sr(el).querySelector('.local-ai-diagnostics summary')?.textContent).toContain('1 note')
    const progress = job.querySelector('[role="progressbar"]')!
    expect(job.getAttribute('data-status')).toBe('running')
    expect(job.querySelector('.job-state')?.textContent).toContain('In progress')
    expect(progress.getAttribute('aria-valuemin')).toBe('0')
    expect(progress.getAttribute('aria-valuemax')).toBe('100')
    expect(progress.getAttribute('aria-valuenow')).toBe('42')
    expect((progress.querySelector('.progress-bar') as HTMLElement).getAttribute('style')).toContain('42%')
    ;(job.querySelector('.button') as HTMLButtonElement).click()
    ;(sr(el).querySelector('[data-action-id="prepare-model"] .button') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.back-button') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.close') as HTMLButtonElement).click()

    expect(jobs).toEqual([{ sectionId: 'local-ai', jobId: 'semantic-index' }])
    expect(actions).toEqual([{ sectionId: 'local-ai', actionId: 'prepare-model' }])
    expect(closes).toBe(2)
  })

  it('states capability absence and credential configuration without placebo controls', async () => {
    const el = await mount((node) => {
      node.activeSection = 'api-keys'
      node.sections = [
        { id: 'api-keys', title: 'AI Provider Keys', notes: ['Provider-key management is unavailable in this runtime.'] },
        { id: 'api-mcp', title: 'API & MCP' },
        { id: 'history', title: 'History', actions: [{ id: 'create-restore-point', label: 'Create restore point' }] },
      ]
    })

    expect(sr(el).querySelector('[data-empty-state="api-keys"] .capability-state-title')?.textContent)
      .toBe('Credential storage is unavailable')
    expect(sr(el).querySelector('.note')?.getAttribute('data-tone')).toBe('warning')
    expect(sr(el).querySelector('[data-secret-id]')).toBeNull()

    ;(sr(el).querySelector('[data-section-id="api-mcp"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(sr(el).querySelector('[data-empty-state="api-mcp"] .capability-state-title')?.textContent)
      .toBe('No external endpoint is exposed')

    ;(sr(el).querySelector('[data-section-id="history"]') as HTMLButtonElement).click()
    await el.updateComplete
    expect(sr(el).querySelector('[data-empty-state="history"] .capability-state-title')?.textContent)
      .toBe('No restore points yet')
    expect(sr(el).querySelector('[data-action-id="create-restore-point"]')).not.toBeNull()
  })

  it('applies 98 and glass styling to the actual settings primitives and keeps mobile navigation horizontal', () => {
    const styles = (MnSettingsPage.styles as unknown as { cssText: string }).cssText
    expect(styles).toContain(":host([data-skin='98']) :is(\n      .panel,")
    expect(styles).toContain(":host([data-skin='98']) .toggle")
    expect(styles).toContain(":host([data-skin='glass']) :is(\n      .panel,")
    expect(styles).toContain(".capability-state")
    expect(styles).toContain('@media (max-width: 760px)')
    expect(styles).toContain('overflow-x: auto')
    expect(styles).toContain('.nav-group + .nav-group')
    expect(styles).not.toContain('.toggle-track')
    expect(styles).not.toContain('.metric-card')
  })
})
