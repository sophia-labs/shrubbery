import { describe, expect, it, vi } from 'vitest'
import {
  accessEmail,
  accessOwnerFromDirectory,
  createControlAccessClient,
  leaveRefusalMessage,
  publicTokenFromHash,
  publicViewUrl,
  shareLinkUrl,
  shareTokenFromHash,
  type ControlAccessRequest,
} from '../control-access.js'

const owner = 'user:owner'
const row = { graph: { owner, graphId: 'notes' }, generation: 1, principal: 'user:reader', role: 'viewer', grantedBy: owner, grantedAtMs: 1788678000000 }

function setup(reply: (request: ControlAccessRequest) => unknown) {
  const request = vi.fn(async (body: ControlAccessRequest) => reply(body))
  return { request, client: createControlAccessClient({ resolveOwner: () => owner, request }) }
}

function envelope(request: ControlAccessRequest, value: unknown) {
  return { jsonrpc: '2.0', id: request.id, result: { structuredContent: value, isError: false } }
}

describe('canonical control access decoder', () => {
  it('accepts a genuinely empty raw ACL array without inventing an owner grant', async () => {
    const { client } = setup(request => envelope(request, []))
    await expect(client.list('notes')).resolves.toEqual([])
    await expect(client.owner('notes')).resolves.toBe(owner)
  })

  it.each([
    ['wrong id', (r: ControlAccessRequest) => ({ ...envelope(r, []), id: 'someone-else' })],
    ['missing structured content', (r: ControlAccessRequest) => ({ jsonrpc: '2.0', id: r.id, result: { content: [] } })],
    ['tool error', (r: ControlAccessRequest) => ({ jsonrpc: '2.0', id: r.id, result: { isError: true, content: [{ type: 'text', text: 'not authorized' }], structuredContent: [] } })],
    ['stdio items wrapper is not the HTTP wire', (r: ControlAccessRequest) => envelope(r, { items: [] })],
    ['malformed row', (r: ControlAccessRequest) => envelope(r, [{}])],
    ['owner pseudo-grant', (r: ControlAccessRequest) => envelope(r, [{ ...row, principal: owner, role: 'owner' }])],
    ['wrong graph', (r: ControlAccessRequest) => envelope(r, [{ ...row, graph: { owner, graphId: 'elsewhere' } }])],
    ['wrong principal kind', (r: ControlAccessRequest) => envelope(r, [{ ...row, principal: 'agent:reader' }])],
    ['duplicate principal', (r: ControlAccessRequest) => envelope(r, [row, row])],
  ])('refuses %s', async (_name, reply) => {
    const { client } = setup(reply)
    await expect(client.list('notes')).rejects.toBeInstanceOf(Error)
  })

  it.each([-32004, -32003, -32009, -32602, -32603])('retains RPC code %s and diagnostic data', async code => {
    const { client } = setup(r => ({ jsonrpc: '2.0', id: r.id, error: { code, message: 'producer refusal', data: { reason: 'synthetic' } } }))
    await expect(client.list('notes')).rejects.toMatchObject({ code, message: 'producer refusal', data: { reason: 'synthetic' } })
  })

  it('requires matching grant/revoke acknowledgement, not HTTP success alone', async () => {
    const { client } = setup(r => envelope(r, [row]))
    await expect(client.put('notes', 'user:reader', { role: 'viewer' })).rejects.toThrow(/identity/)
    await expect(client.remove('notes', 'user:reader')).rejects.toThrow(/acknowledgement/)
  })

  it('rejects unsupported metadata and owner mutation before control requests', async () => {
    const { client, request } = setup(r => envelope(r, row))
    await expect(client.put('notes', 'user:reader', { role: 'viewer', email: 'reader@example.test' })).rejects.toThrow(/metadata/)
    await expect(client.put('notes', owner, { role: 'editor' })).rejects.toThrow(/owner/)
    await expect(client.remove('notes', owner)).rejects.toThrow(/owner/)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('access owner discovery', () => {
  it('accepts directory envelopes while keeping the complete typed owner', () => {
    expect(accessOwnerFromDirectory({ items: [{ owner, graphId: 'notes' }] }, 'notes')).toBe(owner)
  })
  it.each([
    { rows: [] },
    { rows: [{ graphId: 'notes' }] },
    { rows: [{ graphId: 'notes', owner: 'owner' }] },
    { rows: [{ graphId: 'notes', owner }, { graphId: 'notes', owner: 'user:other' }] },
  ])('refuses missing, untyped or ambiguous identity ($rows)', ({ rows }) => {
    expect(() => accessOwnerFromDirectory(rows, 'notes')).toThrow()
  })
})

describe('graph sharing contract', () => {
  const linkId = 'a'.repeat(64)
  const token = `shr_${'B'.repeat(43)}`
  const link = { linkId, graph: { owner, graphId: 'notes' }, generation: 1, role: 'editor', createdBy: owner, createdAtMs: 1788678000000, expiresAtMs: 1789000000000, label: 'Lab', live: true }

  it('decodes the owner sharing view without tokens and with the everyone grant', async () => {
    const { client, request } = setup(r => envelope(r, {
      graph: { owner, graphId: 'notes' }, generation: 1, people: [],
      everyone: { principal: 'everyone:authenticated', role: 'viewer', graph: { owner, graphId: 'notes' } },
      links: [link],
    }))
    const sharing = await client.sharing('notes')
    expect(sharing.everyone).toBe(true)
    expect(sharing.links).toEqual([{
      linkId, role: 'editor', createdAt: new Date(1788678000000).toISOString(), createdBy: owner,
      expiresAt: new Date(1789000000000).toISOString(), label: 'Lab', live: true,
    }])
    expect(request.mock.calls[0][0].params).toEqual({ name: 'get_sharing', arguments: { owner, graphId: 'notes' } })
  })

  it.each([
    ['foreign graph', { graph: { owner, graphId: 'other' }, links: [], everyone: null }],
    ['editor everyone', { graph: { owner, graphId: 'notes' }, links: [], everyone: { principal: 'everyone:authenticated', role: 'editor' } }],
    ['bad link id', { graph: { owner, graphId: 'notes' }, links: [{ ...link, linkId: 'x' }], everyone: null }],
    ['duplicate links', { graph: { owner, graphId: 'notes' }, links: [link, link], everyone: null }],
  ])('refuses a sharing view with %s', async (_name, value) => {
    const { client } = setup(r => envelope(r, value))
    await expect(client.sharing('notes')).rejects.toBeInstanceOf(Error)
  })

  it('grants and revokes everyone as Viewer only, confirmed by acknowledgement', async () => {
    const { client, request } = setup(r => envelope(r, r.params.arguments.action === 'grant'
      ? { principal: 'everyone:authenticated', role: 'viewer' } : { revoked: true }))
    await client.setEveryone('notes', true)
    await client.setEveryone('notes', false)
    expect(request.mock.calls.map(call => call[0].params.arguments)).toEqual([
      { owner, graphId: 'notes', action: 'grant', principal: 'everyone:authenticated', role: 'viewer' },
      { owner, graphId: 'notes', action: 'revoke', principal: 'everyone:authenticated' },
    ])
    const wrong = setup(r => envelope(r, { principal: 'everyone:authenticated', role: 'editor' }))
    await expect(wrong.client.setEveryone('notes', true)).rejects.toThrow(/acknowledgement/)
  })

  it('creates a link, returning its one-time token, and validates inputs before any request', async () => {
    const { client, request } = setup(r => envelope(r, { ...link, token }))
    const minted = await client.createLink('notes', { role: 'editor', expiresInSeconds: 86_400, label: ' Lab ' })
    expect(minted.token).toBe(token)
    expect(minted.link.linkId).toBe(linkId)
    expect(request.mock.calls[0][0].params).toEqual({
      name: 'manage_share_links',
      arguments: { owner, graphId: 'notes', action: 'create', role: 'editor', expiresInSeconds: 86_400, label: 'Lab' },
    })
    await expect(client.createLink('notes', { role: 'owner' as 'editor' })).rejects.toThrow(/role/)
    await expect(client.createLink('notes', { role: 'viewer', expiresInSeconds: 5 })).rejects.toThrow(/lifetime/)
    expect(request).toHaveBeenCalledTimes(1)
    const noToken = setup(r => envelope(r, link))
    await expect(noToken.client.createLink('notes', { role: 'editor' })).rejects.toThrow(/malformed/)
  })

  it('revokes by link id and redeems only well-formed tokens', async () => {
    const { client, request } = setup(r => envelope(r, r.params.name === 'redeem_share_link'
      ? { graph: { owner, graphId: 'notes' }, role: 'viewer', generation: 1 } : { revoked: true }))
    await client.revokeLink('notes', linkId)
    await expect(client.revokeLink('notes', 'nope')).rejects.toThrow(/invalid/)
    await expect(client.redeem(token)).resolves.toEqual({ owner, graphId: 'notes', role: 'viewer' })
    await expect(client.redeem('not-a-token')).rejects.toThrow(/malformed/)
    expect(request.mock.calls.map(call => call[0].params.name)).toEqual(['manage_share_links', 'redeem_share_link'])
    expect(request.mock.calls[1][0].params.arguments).toEqual({ token })
  })

  it('builds and parses fragment share URLs', () => {
    expect(shareLinkUrl('https://garden.sophia-labs.com/', token)).toBe(`https://garden.sophia-labs.com/#share=${token}`)
    expect(shareTokenFromHash(`#share=${token}`)).toBe(token)
    expect(shareTokenFromHash('#share=garbage')).toBeNull()
    expect(shareTokenFromHash('')).toBeNull()
  })
})

describe('sharing by email, invitations and the public link', () => {
  const graph = { owner, graphId: 'notes' }
  const publicToken = `shp_${'P'.repeat(43)}`
  const publicId = 'c'.repeat(64)
  const invitationRow = { invitationId: 'inv-1', graph, generation: 1, email: 'ada@example.test', role: 'viewer', invitedBy: owner, createdAtMs: 1788678000000, acceptedBy: null, acceptedAtMs: null }

  it('lists people with their names, tolerating the everyone and public-link rows', async () => {
    const { client } = setup(r => envelope(r, r.params.name === 'manage_access'
      ? [row, { ...row, principal: 'everyone:authenticated' }, { ...row, principal: `share:${publicId}` }]
      : {
          graph, generation: 1,
          people: [
            { ...row, person: { name: 'Ada Reader', email: 'ada@example.test' } },
            { ...row, principal: 'user:quiet', person: {} },
            { ...row, principal: 'everyone:authenticated' },
          ],
          everyone: null,
          links: [],
          invitations: [invitationRow],
          publicLink: { linkId: publicId, token: publicToken, role: 'viewer', createdAtMs: 1788678000000, live: true },
        }))
    await expect(client.list('notes')).resolves.toEqual([
      { userId: 'user:reader', role: 'viewer', grantedAt: new Date(1788678000000).toISOString(), grantedBy: owner },
    ])
    const sharing = await client.sharing('notes')
    expect(sharing.people.map(person => [person.userId, person.person])).toEqual([
      ['user:reader', { name: 'Ada Reader', email: 'ada@example.test' }],
      ['user:quiet', { name: null, email: null }],
    ])
    expect(sharing.invitations).toEqual([{
      invitationId: 'inv-1', email: 'ada@example.test', role: 'viewer', invitedBy: owner,
      createdAt: new Date(1788678000000).toISOString(), expiresAt: null,
    }])
    expect(sharing.publicLink).toEqual({
      linkId: publicId, token: publicToken, role: 'viewer', createdAt: new Date(1788678000000).toISOString(),
      expiresAt: null, label: null, live: true,
    })
  })

  it('reads an older sharing view without people, invitations or a public link', async () => {
    const { client } = setup(r => envelope(r, { graph, generation: 1, everyone: null, links: [] }))
    await expect(client.sharing('notes')).resolves.toMatchObject({ people: [], invitations: [], publicLink: null })
  })

  it.each([
    ['an editor public link', { publicLink: { linkId: publicId, token: publicToken, role: 'editor', createdAtMs: 1 } }],
    ['a public link with a join token', { publicLink: { linkId: publicId, token: `shr_${'B'.repeat(43)}`, role: 'viewer', createdAtMs: 1 } }],
    ['a foreign invitation', { invitations: [{ ...invitationRow, graph: { owner, graphId: 'other' } }] }],
    ['duplicate invitations', { invitations: [invitationRow, invitationRow] }],
  ])('refuses a sharing view with %s', async (_name, extra) => {
    const { client } = setup(r => envelope(r, { graph, generation: 1, everyone: null, links: [], ...extra }))
    await expect(client.sharing('notes')).rejects.toBeInstanceOf(Error)
  })

  it('shares by email: a known account is granted with its name, anyone else is invited', async () => {
    const granted = setup(r => envelope(r, { outcome: 'granted', grant: { ...row, role: 'editor' }, person: { name: 'Ada Reader', email: 'ada@example.test' } }))
    await expect(granted.client.shareWithEmail('notes', '  Ada@Example.TEST ', 'editor')).resolves.toEqual({
      outcome: 'granted',
      grant: { userId: 'user:reader', role: 'editor', grantedAt: new Date(1788678000000).toISOString(), grantedBy: owner },
      person: { name: 'Ada Reader', email: 'ada@example.test' },
    })
    expect(granted.request.mock.calls[0][0].params).toEqual({
      name: 'share_with_email', arguments: { owner, graphId: 'notes', email: 'ada@example.test', role: 'editor' },
    })

    const invited = setup(r => envelope(r, { outcome: 'invited', invitation: invitationRow }))
    await expect(invited.client.shareWithEmail('notes', 'ada@example.test', 'viewer')).resolves.toMatchObject({
      outcome: 'invited', invitation: { invitationId: 'inv-1', email: 'ada@example.test', role: 'viewer' },
    })

    const mismatched = setup(r => envelope(r, { outcome: 'invited', invitation: { ...invitationRow, role: 'editor' } }))
    await expect(mismatched.client.shareWithEmail('notes', 'ada@example.test', 'viewer')).rejects.toThrow(/acknowledgement/)
    const neither = setup(r => envelope(r, { outcome: 'pending' }))
    await expect(neither.client.shareWithEmail('notes', 'ada@example.test', 'viewer')).rejects.toThrow(/neither/)

    const refused = setup(r => envelope(r, {}))
    await expect(refused.client.shareWithEmail('notes', 'not an email', 'viewer')).rejects.toThrow(/email address/)
    expect(refused.request).not.toHaveBeenCalled()
  })

  it('cancels an invitation by id and creates the public link as a Viewer public audience', async () => {
    const { client, request } = setup(r => envelope(r, r.params.name === 'cancel_graph_invitation'
      ? { cancelled: true }
      : { linkId: publicId, graph, generation: 1, role: 'viewer', createdBy: owner, createdAtMs: 1788678000000, token: publicToken }))
    await client.cancelInvitation('notes', ' inv-1 ')
    const link = await client.createPublicLink('notes')
    expect(link).toMatchObject({ linkId: publicId, token: publicToken, role: 'viewer', live: true })
    expect(request.mock.calls.map(call => call[0].params)).toEqual([
      { name: 'cancel_graph_invitation', arguments: { owner, graphId: 'notes', invitationId: 'inv-1' } },
      { name: 'manage_share_links', arguments: { owner, graphId: 'notes', action: 'create', audience: 'public', role: 'viewer' } },
    ])
    await expect(client.cancelInvitation('notes', '  ')).rejects.toThrow(/invalid/)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('builds and parses /view public URLs and normalizes emails', () => {
    expect(publicViewUrl('https://garden.sophia-labs.com/', publicToken)).toBe(`https://garden.sophia-labs.com/view#${publicToken}`)
    expect(publicTokenFromHash(`#${publicToken}`)).toBe(publicToken)
    expect(publicTokenFromHash(`#token=${publicToken}`)).toBe(publicToken)
    expect(publicTokenFromHash(`#shr_${'B'.repeat(43)}`)).toBeNull()
    expect(publicTokenFromHash('#shp_short')).toBeNull()
    expect(publicTokenFromHash('')).toBeNull()
    expect(accessEmail(' Ada@Example.Test ')).toBe('ada@example.test')
    expect(() => accessEmail('user:reader')).toThrow()
  })
})

describe('leaving a graph someone shared', () => {
  it('asks leave_graph for the owner and graph, and accepts only {left: true}', async () => {
    const { client, request } = setup(r => envelope(r, { left: true }))
    await expect(client.leave('notes')).resolves.toBeUndefined()
    expect(request.mock.calls.map(call => call[0].params)).toEqual([
      { name: 'leave_graph', arguments: { owner, graphId: 'notes' } },
    ])
    const refused = setup(r => envelope(r, { left: false }))
    await expect(refused.client.leave('notes')).rejects.toThrow(/acknowledgement/)
  })

  it('says why a leave was refused: the gateway\'s reason for -32009, plain words for -32004', async () => {
    const owned = setup(r => ({ jsonrpc: '2.0', id: r.id, error: { code: -32009, message: 'You can view this graph because it is shared with everyone signed in; there is nothing to leave.' } }))
    const error = await owned.client.leave('notes').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: -32009 })
    expect(leaveRefusalMessage(error)).toBe('You can view this graph because it is shared with everyone signed in; there is nothing to leave.')
    const gone = setup(r => ({ jsonrpc: '2.0', id: r.id, error: { code: -32004, message: 'graph not found' } }))
    expect(leaveRefusalMessage(await gone.client.leave('notes').catch((caught: unknown) => caught)))
      .toBe('This graph is no longer available, or you have already left it.')
  })
})
