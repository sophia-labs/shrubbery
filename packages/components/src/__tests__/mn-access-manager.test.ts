import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import '../mn-access-manager.js'
import type {
  MnAccessSharing,
  MnGeneralAccessChangeDetail,
  MnShareLinkCreateDetail,
  MnShareLinkRevokeDetail,
  MnAccessAddDetail,
  MnAccessInvitationCancelDetail,
  MnAccessInviteDetail,
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
    currentUserId: 'owner-1',
    memberLinkUrl: 'https://garden.example.test/g/graph-a',
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

async function settle(element: MnAccessManager): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await element.updateComplete
}

afterEach(() => document.body.replaceChildren())

describe('mn-access-manager', () => {
  beforeAll(() => expect(customElements.get('mn-access-manager')).toBeDefined())

  it('does not turn a refused people read into a known empty list', async () => {
    const element = await mount(model({ status: 'error', grants: [], error: 'graph not found' }))
    const root = await open(element)
    expect(root.textContent).not.toMatch(/0 members|0 access grants/)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('graph not found')
    expect(root.querySelector<HTMLInputElement>('[name="access-email"]')?.disabled).toBe(true)
    expect(root.querySelector<HTMLButtonElement>('.invite-button')?.disabled).toBe(true)
  })

  it('opens an accessible Share dialog and asks the shell to load', async () => {
    const element = await mount(model({ status: 'idle', grants: [] }))
    let opens = 0
    element.addEventListener('mn-access-open', () => { opens += 1 })
    const root = await open(element)

    expect(opens).toBe(1)
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Workspace access')
    expect(root.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(false)
    expect(root.querySelector('[aria-label="Manage workspace access"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(root.querySelector('.title')?.textContent).toBe('Share “Research Garden”')
    expect(root.textContent).toContain('Add people')
    expect(root.textContent).toContain('People with access')
    expect(root.textContent).not.toContain('not an email invitation')
    expect(root.querySelector('.close')).toBe(root.activeElement)
  })

  it('opens when the host asks, once per request', async () => {
    const element = await mount(model({ openRequest: null }))
    let opens = 0
    element.addEventListener('mn-access-open', () => { opens += 1 })
    expect(element.shadowRoot!.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(true)
    element.model = model({ openRequest: 1 })
    await settle(element)
    expect(element.shadowRoot!.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(false)
    expect(opens).toBe(1)
    element.shadowRoot!.querySelector<HTMLButtonElement>('.close')!.click()
    await element.updateComplete
    element.model = model({ openRequest: 1, notice: 'refreshed' })
    await settle(element)
    expect(element.shadowRoot!.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(true)
    expect(opens).toBe(1)
  })

  it('lists people by name with the owner first, protects the owner row, and emits role/remove intents', async () => {
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

    const rows = root.querySelectorAll('.member-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-user-id')).toBe('owner-1')
    expect(rows[0].querySelector('.name')?.textContent).toContain('Vera Owner')
    expect(rows[0].querySelector('.name')?.textContent).toContain('(you)')
    expect(root.querySelector('[data-user-id="owner-1"] .role')?.textContent).toBe('Owner')
    expect(root.querySelector('[data-user-id="owner-1"] select')).toBeNull()
    expect(root.querySelector('[data-user-id="owner-1"] .remove')).toBeNull()
    expect(root.querySelector('[data-user-id="editor-2"] .secondary')?.textContent).toBe('editor@example.test')
    expect(root.querySelector('[data-user-id="editor-2"] .user-id')).toBeNull()

    const role = root.querySelector<HTMLSelectElement>('[aria-label="Role for Eddie Editor"]')!
    role.value = 'viewer'
    role.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    root.querySelector<HTMLButtonElement>('[aria-label="Remove Eddie Editor"]')!.click()
    expect(roleChanges).toEqual([{ userId: 'editor-2', role: 'viewer' }])
    expect(removals).toEqual([{ userId: 'editor-2' }])
  })

  it('adds people by email (or a typed user id) and refuses malformed or duplicate entries', async () => {
    const element = await mount()
    const root = await open(element)
    const invites: MnAccessInviteDetail[] = []
    const additions: MnAccessAddDetail[] = []
    element.addEventListener('mn-access-invite', event => invites.push((event as CustomEvent<MnAccessInviteDetail>).detail))
    element.addEventListener('mn-access-add', event => additions.push((event as CustomEvent<MnAccessAddDetail>).detail))
    const submit = async () => {
      root.querySelector<HTMLFormElement>('.invite-form')!.requestSubmit()
      await element.updateComplete
    }

    input(root, 'access-email', 'not an email')
    await submit()
    expect(root.querySelector('.validation')?.textContent).toContain('Enter an email address')

    input(root, 'access-email', ' Editor@Example.test ')
    await submit()
    expect(root.querySelector('.validation')?.textContent).toContain('already has access')
    expect(invites).toEqual([])

    input(root, 'access-email', ' Ada@Example.test ')
    const role = root.querySelector<HTMLSelectElement>('[name="access-role"]')!
    role.value = 'viewer'
    role.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    await submit()
    expect(invites).toEqual([{ email: 'ada@example.test', role: 'viewer' }])

    input(root, 'access-email', 'user:viewer-3')
    await submit()
    expect(additions).toEqual([{ userId: 'user:viewer-3', role: 'viewer' }])
    expect(root.querySelector('.validation')).toBeNull()
  })

  it('shows the name of a person granted at once', async () => {
    const element = await mount(model({ inviteResult: { outcome: 'granted', email: 'ada@example.test', name: 'Ada Reader', role: 'viewer' } }))
    const root = await open(element)
    expect(root.querySelector('.invite-result[data-outcome="granted"]')?.textContent).toContain('Ada Reader can now view this graph.')
    expect(root.querySelector('[data-copy="message"]')).toBeNull()
  })

  it('shows an invited email with a message to copy, since Sophia sends no email', async () => {
    const message = 'Vera has shared “Research Garden” with you on Sophia. …'
    const element = await mount(model({ inviteResult: { outcome: 'invited', email: 'bob@example.test', role: 'editor', message } }))
    const root = await open(element)
    const result = root.querySelector('.invite-result[data-outcome="invited"]')!
    expect(result.textContent).toContain('bob@example.test')
    expect(result.textContent).toContain('Invited · they\'ll get access when they sign in with this email')
    expect(result.textContent).toContain('send them this message yourself')
    root.querySelector<HTMLButtonElement>('[data-copy="message"]')!.click()
    await settle(element)
    expect(await navigator.clipboard.readText()).toBe(message)
    expect(root.querySelector('[data-copy="message"]')?.textContent?.trim()).toBe('Copied')
  })

  it('lists pending invitations beside people, each with cancel', async () => {
    const element = await mount(model({ sharing: {
      status: 'ready', everyone: false, links: [],
      invitations: [{ invitationId: 'inv-1', email: 'bob@example.test', role: 'editor', createdAt: '2026-10-26T10:00:00Z', expiresAt: null }],
    } }))
    const root = await open(element)
    const cancels: MnAccessInvitationCancelDetail[] = []
    element.addEventListener('mn-access-invitation-cancel', event => cancels.push((event as CustomEvent<MnAccessInvitationCancelDetail>).detail))
    const row = root.querySelector('[data-invitation-id="inv-1"]')!
    expect(row.textContent).toContain('bob@example.test')
    expect(row.textContent).toContain('Invited · Editor')
    row.querySelector<HTMLButtonElement>('[aria-label="Cancel the invitation for bob@example.test"]')!.click()
    expect(cancels).toEqual([{ invitationId: 'inv-1' }])
  })

  it('copies the graph link for people with access', async () => {
    const element = await mount()
    const root = await open(element)
    expect(root.querySelector('.footer')?.textContent).toContain('Only people with access can open this link.')
    root.querySelector<HTMLButtonElement>('[data-copy="member"]')!.click()
    await settle(element)
    expect(await navigator.clipboard.readText()).toBe('https://garden.example.test/g/graph-a')
  })

  it('shows non-owners their role and that only the owner changes access, never the controls', async () => {
    const element = await mount(model({ currentRole: 'viewer', grants: [], currentUserId: 'viewer-9', sharing: { status: 'ready', everyone: false, links: [] } }))
    const root = await open(element)
    expect(root.querySelector('.permission-note')?.textContent).toContain('You can view this graph.')
    expect(root.querySelector('.permission-note')?.textContent).toContain('Only the owner can change who has access.')
    expect(root.querySelector('.invite-form')).toBeNull()
    expect(root.querySelector('.role-select')).toBeNull()
    expect(root.querySelector('.remove')).toBeNull()
    expect(root.querySelector('[name="access-general"]')).toBeNull()
    expect(root.querySelector('[data-copy="member"]')).not.toBeNull()

    document.body.replaceChildren()
    const editorRoot = await open(await mount(model({ currentRole: 'editor', grants: [] })))
    expect(editorRoot.querySelector('.permission-note')?.textContent).toContain('You can edit this graph.')
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
    const publicUrl = `https://garden.example.test/view#shp_${'P'.repeat(43)}`
    const sharing = (overrides: Partial<MnAccessSharing> = {}): MnAccessSharing => ({
      status: 'ready',
      everyone: false,
      generalAccess: 'restricted',
      publicLinkUrl: null,
      invitations: [],
      links: [
        { linkId, role: 'editor', createdAt: '2026-09-22T12:00:00Z', expiresAt: null, label: 'Lab', live: true },
        { linkId: 'b'.repeat(64), role: 'viewer', createdAt: '2026-09-01T12:00:00Z', expiresAt: '2026-09-02T12:00:00Z', label: null, live: false },
      ],
      createdLinkUrl: null,
      busyAction: null,
      error: null,
      ...overrides,
    })

    it('keeps people only when the host has no sharing capability', async () => {
      const root = await open(await mount())
      expect(root.querySelector('[name="access-general"]')).toBeNull()
      expect(root.querySelector('.link-form')).toBeNull()
      expect(root.querySelector('.invite-form')).not.toBeNull()
    })

    it('offers General access as one choice of three and emits the chosen one', async () => {
      const element = await mount(model({ sharing: sharing() }))
      const root = await open(element)
      const changes: MnGeneralAccessChangeDetail[] = []
      element.addEventListener('mn-access-general-change', e => changes.push((e as CustomEvent<MnGeneralAccessChangeDetail>).detail))

      const radios = [...root.querySelectorAll<HTMLInputElement>('[name="access-general"]')]
      expect(radios.map(radio => radio.value)).toEqual(['restricted', 'signed-in', 'public'])
      expect(radios.map(radio => radio.checked)).toEqual([true, false, false])
      expect(root.textContent).toContain('Anyone signed in to Sophia can view')
      expect(root.textContent).toContain('Anyone with the link can view, no account needed')

      radios[2].checked = true
      radios[2].dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      radios[1].checked = true
      radios[1].dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      expect(changes).toEqual([{ access: 'public' }, { access: 'signed-in' }])

      // The host has not changed anything yet: the choice shown is still the host's.
      element.model = model({ sharing: sharing() })
      await element.updateComplete
      expect(radios.map(radio => radio.checked)).toEqual([true, false, false])
    })

    it('shows the public link with Copy link while anyone with the link can view', async () => {
      const element = await mount(model({ sharing: sharing({ generalAccess: 'public', publicLinkUrl: publicUrl }) }))
      const root = await open(element)
      const radios = [...root.querySelectorAll<HTMLInputElement>('[name="access-general"]')]
      expect(radios.map(radio => radio.checked)).toEqual([false, false, true])
      expect(root.querySelector<HTMLInputElement>('[name="public-link-url"]')!.value).toBe(publicUrl)
      root.querySelector<HTMLButtonElement>('[data-copy="public"]')!.click()
      await settle(element)
      expect(await navigator.clipboard.readText()).toBe(publicUrl)
      expect(root.querySelector('[data-copy="public"]')?.textContent?.trim()).toBe('Copied')
    })

    it('follows the everyone grant when the host gives no general-access choice', async () => {
      const root = await open(await mount(model({ sharing: sharing({ generalAccess: undefined, everyone: true }) })))
      const radios = [...root.querySelectorAll<HTMLInputElement>('[name="access-general"]')]
      expect(radios.map(radio => radio.checked)).toEqual([false, true, false])
      expect(root.querySelector('[name="public-link-url"]')).toBeNull()
    })

    it('folds invite links away with the honest note, and still creates and revokes them', async () => {
      const element = await mount(model({ sharing: sharing() }))
      const root = await open(element)
      const creates: MnShareLinkCreateDetail[] = []
      const revokes: MnShareLinkRevokeDetail[] = []
      element.addEventListener('mn-access-link-create', e => creates.push((e as CustomEvent<MnShareLinkCreateDetail>).detail))
      element.addEventListener('mn-access-link-revoke', e => revokes.push((e as CustomEvent<MnShareLinkRevokeDetail>).detail))

      const details = root.querySelector<HTMLDetailsElement>('details.invite-links')!
      expect(details.open).toBe(false)
      expect(details.querySelector('summary')?.textContent).toBe('Invite links')
      expect(details.textContent).toContain('People who joined keep their access after the link is revoked')

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
    })

    it('opens Invite links to show a newly created link once, with copy and dismiss', async () => {
      const url = `https://garden.example.test/#share=shr_${'C'.repeat(43)}`
      const element = await mount(model({ sharing: sharing({ createdLinkUrl: url }) }))
      const root = await open(element)
      let dismissed = 0
      element.addEventListener('mn-access-link-dismiss', () => { dismissed += 1 })
      expect(root.querySelector<HTMLDetailsElement>('details.invite-links')!.open).toBe(true)
      expect(root.querySelector<HTMLInputElement>('[name="share-link-url"]')!.value).toBe(url)
      expect(root.textContent).toContain('shown only once')
      root.querySelector<HTMLButtonElement>('.dismiss')!.click()
      expect(dismissed).toBe(1)
    })

    it('disables sharing controls while busy and shows the sharing error', async () => {
      const root = await open(await mount(model({ sharing: sharing({ busyAction: 'general', error: 'refused' }) })))
      expect([...root.querySelectorAll<HTMLInputElement>('[name="access-general"]')].every(radio => radio.disabled)).toBe(true)
      expect(root.querySelector<HTMLButtonElement>('.link-create')!.disabled).toBe(true)
      expect(root.textContent).toContain('refused')
    })
  })
})
