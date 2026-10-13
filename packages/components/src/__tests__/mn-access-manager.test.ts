import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import '../mn-access-manager.js'
import type {
  MnAccessSharing,
  MnEveryoneChangeDetail,
  MnShareLinkCreateDetail,
  MnShareLinkRevokeDetail,
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

  it('does not turn a refused membership read into a known zero-member count', async () => {
    const element = await mount(model({ status: 'error', grants: [], error: 'graph not found' }))
    const root = await open(element)
    expect(root.querySelector('.toolbar')?.textContent).not.toMatch(/0 members|0 access grants/)
    expect(root.querySelector('.toolbar')?.textContent).toContain('Membership unavailable')
    expect(root.querySelector<HTMLInputElement>('[name="access-user-id"]')?.disabled).toBe(true)
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  })

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
    expect(root.textContent).toContain('not an email invitation')
    expect(root.querySelector('.close')).toBe(root.activeElement)
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

  it('collects typed user id without unsupported metadata and rejects invalid/duplicate grants', async () => {
    const element = await mount(model({ grants: [{ ...grants[1], userId: 'user:editor-2' }] }))
    const root = await open(element)
    const additions: MnAccessAddDetail[] = []
    element.addEventListener('mn-access-add', event => {
      additions.push((event as CustomEvent<MnAccessAddDetail>).detail)
    })

    input(root, 'access-user-id', ' editor-2 ')
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await element.updateComplete
    expect(additions).toEqual([])
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('typed user ID')

    input(root, 'access-user-id', ' user:editor-2 ')
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await element.updateComplete
    expect(additions).toEqual([])
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('already has access')

    input(root, 'access-user-id', 'user:viewer-3')
    expect(root.querySelector('[name="access-email"]')).toBeNull()
    expect(root.querySelector('[name="access-display-name"]')).toBeNull()
    const role = root.querySelector<HTMLSelectElement>('[name="access-role"]')!
    role.value = 'viewer'
    role.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    root.querySelector<HTMLFormElement>('form')!.requestSubmit()
    expect(additions).toEqual([{
      userId: 'user:viewer-3',
      role: 'viewer',
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

  describe('sharing', () => {
    const linkId = 'a'.repeat(64)
    const sharing = (overrides: Partial<MnAccessSharing> = {}): MnAccessSharing => ({
      status: 'ready',
      everyone: false,
      links: [
        { linkId, role: 'editor', createdAt: '2026-09-22T12:00:00Z', expiresAt: null, label: 'Lab', live: true },
        { linkId: 'b'.repeat(64), role: 'viewer', createdAt: '2026-09-01T12:00:00Z', expiresAt: '2026-09-02T12:00:00Z', label: null, live: false },
      ],
      createdLinkUrl: null,
      busyAction: null,
      error: null,
      ...overrides,
    })

    it('keeps the member-only dialog when the host has no sharing capability', async () => {
      const root = await open(await mount())
      expect(root.querySelector('[name="access-everyone"]')).toBeNull()
      expect(root.querySelector('.link-form')).toBeNull()
      expect(root.textContent).toContain('Public-link controls are not available')
    })

    it('lets the owner toggle everyone, create links with role and expiry, and revoke links', async () => {
      const element = await mount(model({ sharing: sharing() }))
      const root = await open(element)
      const everyone: MnEveryoneChangeDetail[] = []
      const creates: MnShareLinkCreateDetail[] = []
      const revokes: MnShareLinkRevokeDetail[] = []
      element.addEventListener('mn-access-everyone-change', e => everyone.push((e as CustomEvent<MnEveryoneChangeDetail>).detail))
      element.addEventListener('mn-access-link-create', e => creates.push((e as CustomEvent<MnShareLinkCreateDetail>).detail))
      element.addEventListener('mn-access-link-revoke', e => revokes.push((e as CustomEvent<MnShareLinkRevokeDetail>).detail))

      expect(root.textContent).toContain('Anyone signed in can view')
      const toggle = root.querySelector<HTMLInputElement>('[name="access-everyone"]')!
      expect(toggle.checked).toBe(false)
      toggle.checked = true
      toggle.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      expect(everyone).toEqual([{ enabled: true }])

      const role = root.querySelector<HTMLSelectElement>('[name="share-link-role"]')!
      role.value = 'editor'
      role.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      const expiry = root.querySelector<HTMLSelectElement>('[name="share-link-expiry"]')!
      expiry.value = '7d'
      expiry.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      await element.updateComplete
      root.querySelector<HTMLFormElement>('.link-form')!.requestSubmit()
      expiry.value = 'never'
      expiry.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      await element.updateComplete
      root.querySelector<HTMLFormElement>('.link-form')!.requestSubmit()
      expect(creates).toEqual([
        { role: 'editor', expiresInSeconds: 7 * 24 * 60 * 60 },
        { role: 'editor', expiresInSeconds: null },
      ])

      const rows = root.querySelectorAll('.link-row')
      expect(rows).toHaveLength(2)
      expect(rows[1].classList.contains('expired')).toBe(true)
      expect(rows[1].textContent).toContain('expired')
      root.querySelector<HTMLButtonElement>(`[data-link-id="${linkId}"] .remove`)!.click()
      expect(revokes).toEqual([{ linkId }])
      expect(root.textContent).not.toContain('Public-link controls are not available')
    })

    it('shows a newly created link once, with copy and dismiss', async () => {
      const url = `https://garden.example.test/#share=shr_${'C'.repeat(43)}`
      const element = await mount(model({ sharing: sharing({ createdLinkUrl: url, everyone: true }) }))
      const root = await open(element)
      let dismissed = 0
      element.addEventListener('mn-access-link-dismiss', () => { dismissed += 1 })
      expect(root.querySelector<HTMLInputElement>('[name="share-link-url"]')!.value).toBe(url)
      expect(root.querySelector<HTMLInputElement>('[name="access-everyone"]')!.checked).toBe(true)
      expect(root.textContent).toContain('shown only once')
      root.querySelector<HTMLButtonElement>('.dismiss')!.click()
      expect(dismissed).toBe(1)
    })

    it('hides sharing controls from non-owners and disables them while busy', async () => {
      const viewerRoot = await open(await mount(model({ currentRole: 'viewer', sharing: sharing() })))
      expect(viewerRoot.querySelector('[name="access-everyone"]')).toBeNull()
      expect(viewerRoot.querySelector('.link-form')).toBeNull()
      document.body.replaceChildren()
      const busyRoot = await open(await mount(model({ sharing: sharing({ busyAction: 'link-create', error: 'refused' }) })))
      expect(busyRoot.querySelector<HTMLInputElement>('[name="access-everyone"]')!.disabled).toBe(true)
      expect(busyRoot.querySelector<HTMLButtonElement>('.link-create')!.disabled).toBe(true)
      expect(busyRoot.querySelector<HTMLButtonElement>('.link-create')!.textContent).toContain('Creating')
      expect(busyRoot.textContent).toContain('refused')
    })
  })
})
