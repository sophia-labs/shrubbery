import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'lit'
import { localeSource } from '@shrubbery/nucleus'
import { beingFaces } from '@shrubbery/nucleus/object-faces'
import '../object-view/choice-dialog-element.js'
import '../object-view/object-view-element.js'
import '../being/being-face-element.js'
import '../workflow-scene.js'
import '../wires-panel/wires-panel.js'
import '../layout/faces/compute-cell-view-element.js'
import { renderFilesEmpty } from '../files-canvas/files-empty.js'

beforeEach(() => localeSource.set('ja'))
afterEach(() => {
  document.body.replaceChildren()
  localeSource.set('en')
})

describe('Japanese runtime surfaces', () => {
  it('renders the shared choice dialog and preserves user-authored names', async () => {
    const element = document.createElement('sh-choice-dialog') as HTMLElement & { items: unknown[]; updateComplete: Promise<unknown> }
    element.items = [{ id: 'one', label: 'Save' }]
    document.body.append(element)
    await element.updateComplete
    expect(element.shadowRoot!.querySelector('h2')?.textContent).toBe('選択')
    expect(element.shadowRoot!.querySelector('.label')?.textContent).toBe('Save')
    element.items = []
    await element.updateComplete
    expect(element.shadowRoot!.textContent).toContain('選択できる項目がありません。')
  })

  it('renders the workflow canvas empty state', async () => {
    const element = document.createElement('sh-workflow-scene') as HTMLElement & { plan: unknown; updateComplete: Promise<unknown> }
    element.plan = { title: 'My workflow', definition: 'urn:workflow:example', status: 'ready', sources: [], steps: [], stacks: [], destinations: [] }
    document.body.append(element)
    await element.updateComplete
    expect(element.shadowRoot!.textContent).toContain('ワークフローで行いたいことをSophiaに伝えると')
  })

  it('renders Compute loading copy', async () => {
    const element = document.createElement('sh-compute-cell-view')
    document.body.append(element)
    await element.updateComplete
    expect(element.shadowRoot!.textContent).toContain('ノートブックのセルを読み込んでいます')
  })

  it('renders object-page empty copy', async () => {
    const element = document.createElement('sh-object-view')
    document.body.append(element)
    await element.updateComplete
    expect(element.shadowRoot!.textContent).toContain('表示する情報がありません。')
  })

  it('renders a being and its sitting count in Japanese', async () => {
    const element = document.createElement('sh-being-face')
    element.face = beingFaces({ posts: [{ id: 'clerk', label: 'Clerk' }], sittings: [{ agentId: 'agent-example', step: 'Clerk', state: 'done' }] })[0]!
    document.body.append(element)
    await element.updateComplete
    expect(element.shadowRoot!.textContent).toContain('作業回数: 1回')
    expect(element.shadowRoot!.textContent).toContain('Clerk')
  })

  it('renders the wires panel', async () => {
    const element = document.createElement('sh-wires-panel')
    element.status = 'ready'
    document.body.append(element)
    await element.updateComplete
    expect(element.shadowRoot!.textContent).toContain('ワイヤーはまだありません')
  })

  it('renders the shared Files canvas empty state', () => {
    const container = document.createElement('div')
    document.body.append(container)
    render(renderFilesEmpty(true), container)
    expect(container.textContent).toContain('このフォルダーは空です。')
    expect(container.textContent).toContain('アップロード')
  })
})
