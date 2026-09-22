import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import '../mn-access-manager.js'
import type {
  MnAccessAddDetail,
  MnAccessManager,
  MnAccessManagerModel,
  MnAccessRemoveDetail,
  MnAccessRoleChangeDetail,
} from '../mn-access-manager.js'

const grants: MnAccessManagerModel['grants'] = [
  {
    userId: 'owner-1',
    role: 'owner',
    grantedAt: '2026-07-10T12:00:00Z',
    grantedBy: 'owner-1',
    email: 'owner@example.test',
    displayName: 'Vera Owner',
  },
  {
    userId: 'editor-2',
    role: 'editor',
    grantedAt: '2026-07-10T12:01:00Z',
    grantedBy: 'owner-1',
    email: 'editor@example.test',
    displayName: 'Eddie Editor',
  },
]

function model(overrides: Partial<MnAccessManagerModel> = {}): MnAccessManagerModel {
  return {
    graphId: 'graph-a',
    graphTitle: 'Research Garden',
    currentRole: 'owner',
    status: 'ready',
    grants,
    error: null,
    notice: null,
    busyUserId: null,
    busyAction: null,
    ...overrides,
  }
}

async function mount(value = model()): Promise<MnAccessManager> {
  const element = document.createElement('mn-access-manager') as MnAccessManager
  element.model = value
  document.body.appendChild(element)
  await element.updateComplete
  return element
}

async function open(element: MnAccessManager): Promise<ShadowRoot> {
  element.shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Manage workspace access"]')!.click()
  await element.updateComplete
  return element.shadowRoot!
}

function input(root: ShadowRoot, name: string, value: string): void {
  const field = root.querySelector<HTMLInputElement>(`[name="${name}"]`)!
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
}

afterEach(() => document.body.replaceChildren())

describe('mn-access-manager', () => {
  beforeAll(() => expect(customElements.get('mn-access-manager')).toBeDefined())

  it('opens an accessible member-only dialog and asks the shell to load grants', async () => {
    const element = await mount(model({ status: 'idle', grants: [] }))
    let opens = 0
    element.addEventListener('mn-access-open', () => { opens += 1 })
    const root = await open(element)

    expect(opens).toBe(1)
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Workspace access')
    expect(root.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(false)
    expect(root.querySelector('[aria-label="Manage workspace access"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(root.textContent).toContain('Member grants only')
    expect(root.textContent).toContain('does not expose share-token creation or revocation')
    expect(root.querySelector('[name="access-user-id"]')).toBe(root.activeElement)
  })

  it('renders owner/member identities, protects the owner row, and emits role/remove intents', async () => {
    const element = await mount()
    const root = await open(element)
    const roleChanges: MnAccessRoleChangeDetail[] = []
    const removals: MnAccessRemoveDetail[] = []
    element.addEventListener('mn-access-role-change', event => {
      roleChanges.push((event as CustomEvent<MnAccessRoleChangeDetail>).detail)
    })
    element.addEventListener('mn-access-remove', event => {
      removals.push((event as CustomEvent<MnAccessRemoveDetail>).detail)
    })

    expect(root.querySelectorAll('.member-row')).toHaveLength(2)
    expect(root.querySelector('[data-user-id="owner-1"] .role')?.textContent).toBe('owner')
    expect(root.querySelector('[data-user-id="owner-1"] select')).toBeNull()
    expect(root.querySelector('[data-user-id="owner-1"] .remove')).toBeNull()

    const role = root.querySelector<HTMLSelectElement>('[aria-label="Role for Eddie Editor"]')!
    role.value = 'viewer'
    role.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    root.querySelector<HTMLButtonElement>('[aria-label="Remove Eddie Editor"]')!.click()
    expect(roleChanges).toEqual([{ userId: 'editor-2', role: 'viewer' }])
    expect(removals).toEqual([{ userId: 'editor-2' }])
  })

  it('collects stable user id plus optional metadata and rejects duplicate grants locally', async () => {
    const element = await mount()
    const root = await open(element)
    const additions: MnAccessAddDetail[] = []
    element.addEventListener('mn-access-add', event => {
      additions.push((event as CustomEvent<MnAccessAddDetail>).detail)
    })

    input(root, 'access-user-id', ' editor-2 ')
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await element.updateComplete
    expect(additions).toEqual([])
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('already has access')

    input(root, 'access-user-id', 'viewer-3')
    input(root, 'access-email', 'viewer@example.test')
    input(root, 'access-display-name', 'Viv Viewer')
    const role = root.querySelector<HTMLSelectElement>('[name="access-role"]')!
    role.value = 'viewer'
    role.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    expect(additions).toEqual([{
      userId: 'viewer-3',
      role: 'viewer',
      email: 'viewer@example.test',
      displayName: 'Viv Viewer',
    }])
  })

  it('shows non-owners the grant list without mutation controls', async () => {
    const element = await mount(model({ currentRole: 'viewer' }))
    const root = await open(element)

    expect(root.querySelectorAll('.member-row')).toHaveLength(2)
    expect(root.querySelector('.role-select')).toBeNull()
    expect(root.querySelector('.remove')).toBeNull()
    expect(root.querySelector('.add-form')).toBeNull()
    expect(root.textContent).toContain('Only the workspace owner can add, change, or remove members')
  })

  it('surfaces backend errors, emits retry, and disables changes while a mutation is busy', async () => {
    const element = await mount(model({
      status: 'error',
      error: 'This workspace is unavailable',
      busyAction: 'role',
      busyUserId: 'editor-2',
    }))
    const root = await open(element)
    let refreshes = 0
    element.addEventListener('mn-access-refresh', () => { refreshes += 1 })

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('unavailable')
    expect(root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button:disabled, select:disabled').length).toBeGreaterThan(1)
    root.querySelector<HTMLButtonElement>('.retry')!.click()
    expect(refreshes).toBe(1)
  })
})
