import { describe, expect, it, vi } from 'vitest'
import { accessOwnerFromDirectory, createControlAccessClient, shareLinkUrl, shareTokenFromHash, type ControlAccessRequest } from '../control-access.js'

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
