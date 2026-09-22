import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import '../mn-garden-home.js'
import type {
  MnGardenHome,
  MnGardenHomeAccount,
  MnGardenHomeAccountDetail,
  MnGardenHomeCreateDetail,
  MnGardenHomeWorkspaceDetail,
} from '../mn-garden-home.js'
import type { MnWorkspaceSummary } from '../mn-workspace-selector.js'

const NOW = Date.now()

const account: MnGardenHomeAccount = {
  userId: 'vera',
  displayName: 'Vera Garden',
  email: 'vera@example.test',
}

const workspaces: readonly MnWorkspaceSummary[] = [
  {
    graphId: 'shared-reading',
    title: 'Shared Reading',
    role: 'editor',
    cellState: 'stopped',
    lastOpenedAt: NOW - 3_600_000,
    memberCount: 4,
  },
  {
    graphId: 'koch-practice',
    title: 'Morse Garden',
    role: 'owner',
    cellState: 'running',
    lastOpenedAt: NOW - 60_000,
    memberCount: 3,
    path: ['Vera', 'Practice'],
  },
  {
    graphId: 'archived',
    title: 'Archived Graph',
    role: 'viewer',
    cellState: 'stopped',
    lastOpenedAt: NOW,
    disabled: true,
    disabledReason: 'Your access is being reviewed.',
  },
]

interface MountOptions {
  account?: MnGardenHomeAccount | null
  workspaces?: readonly MnWorkspaceSummary[]
  status?: MnGardenHome['status']
  error?: string | null
}

async function mount(options: MountOptions = {}): Promise<MnGardenHome> {
  const element = document.createElement('mn-garden-home') as MnGardenHome
  element.account = options.account === undefined ? account : options.account
  element.workspaces = options.workspaces ?? workspaces
  element.status = options.status ?? 'ready'
  element.error = options.error ?? null
  document.body.appendChild(element)
  await element.updateComplete
  return element
}

afterEach(() => document.body.replaceChildren())

describe('mn-garden-home', () => {
  beforeAll(() => expect(customElements.get('mn-garden-home')).toBeDefined())

  it('renders a quiet account doorway with recent and complete graph testimony', async () => {
    const element = await mount()
    const root = element.shadowRoot!

    expect(root.querySelector('main')?.getAttribute('aria-labelledby')).toBe('garden-home-title')
    expect(root.querySelector('#garden-home-title')?.textContent).toBe('Welcome back, Vera.')
    expect(root.querySelector('.account')?.getAttribute('aria-label')).toBe('Open account')
    expect(root.querySelectorAll('.graph-card')).toHaveLength(3)
    expect(root.querySelector('[data-graph-id="koch-practice"]')?.textContent).toContain('3 members')
    expect(root.querySelector('[data-graph-id="koch-practice"]')?.textContent).toContain('Vera')
    expect(root.querySelector<HTMLElement & { label: string }>('[data-graph-id="shared-reading"] mn-badge')?.label).toBe('Editor')
    expect(root.querySelector('[data-graph-id="archived"]')?.textContent).toContain('access is being reviewed')

    const recent = [...root.querySelectorAll('.recent-title')].map(node => node.textContent)
    expect(recent).toEqual(['Morse Garden', 'Shared Reading'])
    expect(recent).not.toContain('Archived Graph')
    expect(root.textContent).not.toContain('Cell asleep')
  })

  it('emits graph, access, and account navigation intents with stable objects', async () => {
    const element = await mount()
    const root = element.shadowRoot!
    const opened: MnGardenHomeWorkspaceDetail[] = []
    const access: MnGardenHomeWorkspaceDetail[] = []
    const accounts: MnGardenHomeAccountDetail[] = []
    element.addEventListener('mn-garden-home-open-graph', event => {
      opened.push((event as CustomEvent<MnGardenHomeWorkspaceDetail>).detail)
    })
    element.addEventListener('mn-garden-home-manage-access', event => {
      access.push((event as CustomEvent<MnGardenHomeWorkspaceDetail>).detail)
    })
    element.addEventListener('mn-garden-home-account', event => {
      accounts.push((event as CustomEvent<MnGardenHomeAccountDetail>).detail)
    })

    const card = root.querySelector<HTMLElement>('[data-graph-id="koch-practice"]')!
    card.querySelector<HTMLButtonElement>('.open-graph')!.click()
    card.querySelector<HTMLButtonElement>('.access')!.click()
    root.querySelector<HTMLButtonElement>('.account')!.click()

    expect(opened).toEqual([{ workspace: workspaces[1] }])
    expect(access).toEqual([{ workspace: workspaces[1] }])
    expect(accounts).toEqual([{ account }])
  })

  it('keeps disabled graphs honest and marks host-controlled graph opening progress', async () => {
    const element = await mount()
    const root = element.shadowRoot!
    const archived = root.querySelector<HTMLElement>('[data-graph-id="archived"]')!
    expect(archived.querySelector<HTMLButtonElement>('.open-graph')!.disabled).toBe(true)

    element.busyGraphId = 'koch-practice'
    await element.updateComplete
    const active = root.querySelector<HTMLElement>('[data-graph-id="koch-practice"]')!
    expect(active.querySelector<HTMLButtonElement>('.open-graph')!.disabled).toBe(true)
    expect(active.querySelector('.open-graph')?.getAttribute('aria-busy')).toBe('true')
    expect(active.textContent).toContain('Opening Morse Garden')
  })

  it('requests one empty graph and reflects host-controlled creation state', async () => {
    const element = await mount()
    const root = element.shadowRoot!
    const creates: MnGardenHomeCreateDetail[] = []
    element.addEventListener('mn-garden-home-create', event => {
      creates.push((event as CustomEvent<MnGardenHomeCreateDetail>).detail)
    })

    root.querySelector<HTMLButtonElement>('.create-toggle')!.click()
    expect(creates).toEqual([{}])

    element.createStatus = 'creating'
    await element.updateComplete
    const create = root.querySelector<HTMLButtonElement>('.create-toggle')!
    expect(create.getAttribute('aria-busy')).toBe('true')
    expect(create.disabled).toBe(true)
    expect(create.textContent).toContain('Creating graph')

    element.createStatus = 'error'
    element.createError = 'Graph quota reached'
    await element.updateComplete
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('quota')
  })

  it('renders loading, retryable catalog error, and first-graph empty states', async () => {
    const element = await mount({ status: 'loading' })
    const root = element.shadowRoot!
    expect(root.querySelector('[role="status"]')?.textContent).toContain('Opening your Garden')
    expect(root.querySelector('.layout')).toBeNull()

    element.status = 'error'
    element.error = 'Catalog request failed'
    await element.updateComplete
    let refreshes = 0
    element.addEventListener('mn-garden-home-refresh', () => { refreshes += 1 })
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Catalog request failed')
    root.querySelector<HTMLElement>('mn-button[label="Try again"]')!.click()
    expect(refreshes).toBe(1)

    element.status = 'ready'
    element.workspaces = []
    await element.updateComplete
    expect(root.textContent).toContain('do not have any graphs yet')
    expect(root.textContent).toContain('new graph starts empty')
    expect(root.querySelector('.recent-list')).toBeNull()
  })
})
