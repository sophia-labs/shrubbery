import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LitElement } from 'lit'
import type { MnIconButton } from '../mn-icon-button.js'
import { localeSource } from '@shrubbery/nucleus'
import '../mn-top-bar.js'
import '../mn-settings-page.js'
import '../mn-confirmation-dialog.js'
import '../mn-input-dialog.js'
import '../mn-editor-toolbar.js'
import '../mn-excalidraw-canvas.js'
import '../mn-sidebar-panel.js'
import '../wf-studio-shell.js'
import '../mn-public-shell.js'
import '../mn-empty-state.js'
import '../mn-access-manager.js'
import '../mn-garden-home.js'

beforeEach(() => localeSource.set('ja'))
afterEach(() => {
  document.body.replaceChildren()
  localeSource.set('en')
})

async function mount<T extends LitElement>(element: T): Promise<ShadowRoot> {
  document.body.append(element)
  await element.updateComplete
  return element.shadowRoot!
}

describe('Japanese visible surfaces', () => {
  it('renders the app shell settings label', async () => {
    const root = await mount(document.createElement('mn-top-bar'))
    expect(root.innerHTML).toContain('設定')
  })

  it('renders Settings navigation and caller-owned section titles', async () => {
    const element = document.createElement('mn-settings-page')
    element.status = 'ready'
    element.activeSection = 'appearance'
    element.sections = [{ id: 'appearance', title: 'Appearance', selects: [{ id: 'language', label: 'Language', value: 'ja', options: [{ value: 'en', label: 'English' }, { value: 'ja', label: '日本語' }] }] }]
    const root = await mount(element)
    expect(root.textContent).toContain('外観')
    expect(root.textContent).toContain('言語')
    expect(root.querySelector('select')?.value).toBe('ja')
  })

  it('renders confirmation and input dialog actions', async () => {
    const confirmation = await mount(document.createElement('mn-confirmation-dialog'))
    const input = await mount(document.createElement('mn-input-dialog'))
    expect(confirmation.textContent).toContain('キャンセル')
    expect(confirmation.textContent).toContain('この操作を続けますか？')
    expect(input.textContent).toContain('キャンセル')
  })

  it('renders document editor chrome', async () => {
    const root = await mount(document.createElement('mn-editor-toolbar'))
    expect(root.innerHTML).toContain('文字の書式')
    const bold = root.querySelector<MnIconButton>('[data-format-command="bold"]')!
    await bold.updateComplete
    expect(bold.shadowRoot!.querySelector('button')?.getAttribute('aria-label')).toBe('太字')
  })

  it('renders whiteboard loading chrome', async () => {
    const element = document.createElement('mn-excalidraw-canvas')
    element.status = 'loading'
    const root = await mount(element)
    expect(root.innerHTML).toContain('シーンのキャンバスを読み込んでいます')
  })

  it('renders Files explorer controls', async () => {
    const root = await mount(document.createElement('mn-sidebar-panel'))
    expect(root.innerHTML).toContain('ファイル')
  })

  it('renders workflow launch chrome', async () => {
    const element = document.createElement('wf-studio-shell')
    element.screen = 'launch'
    const root = await mount(element)
    expect(root.textContent).toContain('ワークフロー')
  })

  it('renders public site navigation and empty states', async () => {
    const element = document.createElement('mn-public-shell')
    element.status = 'ready'
    const root = await mount(element)
    expect(root.innerHTML).toContain('公開ドキュメント')
    expect(root.innerHTML).toContain('ドキュメントがありません')
  })

  it('renders the Share dialog, its general access and the View only chip in Japanese', async () => {
    const element = document.createElement('mn-access-manager')
    element.model = {
      graphId: 'g', graphTitle: 'Research Garden', currentRole: 'owner', status: 'ready', grants: [],
      sharing: { status: 'ready', everyone: false, links: [], generalAccess: 'public', publicLinkUrl: `https://garden.example.test/view#shp_${'P'.repeat(43)}` },
      memberLinkUrl: 'https://garden.example.test/g/g',
    }
    const root = await mount(element)
    expect(root.textContent).toContain('「Research Garden」を共有')
    expect(root.textContent).toContain('ユーザーを追加')
    expect(root.textContent).toContain('アクセスできるユーザー')
    expect(root.textContent).toContain('リンクを知っている全員が閲覧可能（アカウント不要）')
    expect(root.textContent).toContain('招待リンク')
    expect(root.textContent).toContain('リンクをコピー')

    const bar = document.createElement('mn-top-bar')
    bar.access = { graphId: 'g', graphTitle: 'G', currentRole: 'viewer', status: 'ready', grants: [] }
    expect((await mount(bar)).textContent).toContain('閲覧のみ')

    const home = document.createElement('mn-garden-home')
    home.status = 'ready'
    home.workspaces = [{ graphId: 's', title: 'Standard', role: 'viewer', cellState: 'running', ownerName: 'Vera' }]
    const homeRoot = await mount(home)
    expect(homeRoot.textContent).toContain('共有アイテム')
    expect(homeRoot.textContent).toContain('Vera さんが共有')
  })

  it('updates an already open surface and re-subscribes after reconnecting', async () => {
    const element = document.createElement('mn-empty-state')
    element.title = 'No documents'
    const root = await mount(element)
    expect(root.textContent).toContain('ドキュメントがありません')
    localeSource.set('en')
    await element.updateComplete
    expect(root.textContent).toContain('No documents')
    element.remove()
    localeSource.set('ja')
    document.body.append(element)
    await element.updateComplete
    expect(root.textContent).toContain('ドキュメントがありません')
  })
})
