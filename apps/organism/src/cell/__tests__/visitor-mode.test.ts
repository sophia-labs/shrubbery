import { describe, expect, it } from 'vitest'
import type { SidebarSection } from '@shrubbery/runtime'
import {
  ownedDocumentIds,
  parseVisitorFences,
  readAccountIdToken,
  visitorDocumentAccess,
  visitorDropRefusal,
  visitorOwns,
  visitorSidebarRefusal,
  type VisitorState,
} from '../visitor-mode.js'

const ACCOUNT = 'acct-0011223344556677'
const fence = { graphId: 'cow-tools-guide', folderId: 'moo', account: ACCOUNT, name: 'Moo Fan', color: '#16a34a' }
const writer: VisitorState = { kind: 'account', fence, signInUrl: 'https://cow-tools.example/' }
const reader: VisitorState = { kind: 'anonymous', fence: null, signInUrl: 'https://cow-tools.example/' }

// The tree as the shell builds it: the visitors' folder `moo` with `moo-sub`, and `guide` elsewhere.
const sections: SidebarSection[] = [{
  id: 'documents',
  label: 'Documents',
  nodes: [
    {
      id: 'moo', label: 'Moo-vements of the Spirit', kind: 'folder', parentId: null, children: [
        { id: 'mine', label: 'My note', kind: 'document', parentId: 'moo', children: [] },
        { id: 'theirs', label: 'Their note', kind: 'document', parentId: 'moo', children: [] },
        { id: 'owners', label: 'Owner in moo', kind: 'document', parentId: 'moo', children: [] },
        { id: 'moo-sub', label: 'Sub', kind: 'folder', parentId: 'moo', children: [
          { id: 'mine-deep', label: 'Deep', kind: 'document', parentId: 'moo-sub', children: [] },
        ] },
      ],
    },
    {
      id: 'elsewhere', label: 'Guide', kind: 'folder', parentId: null, children: [
        { id: 'guide', label: 'The guide', kind: 'document', parentId: 'elsewhere', children: [] },
        { id: 'moved-out', label: 'Moved out', kind: 'document', parentId: 'elsewhere', children: [] },
      ],
    },
  ],
}] as unknown as SidebarSection[]

// gardend's get_workspace: each document row's extra.createdBy.
const workspace = { documents: [
  { id: 'mine', title: 'My note', extra: { createdBy: ACCOUNT, createdByName: 'Moo Fan' } },
  { id: 'mine-deep', createdBy: ACCOUNT },
  { id: 'moved-out', extra: { createdBy: ACCOUNT } },
  { id: 'theirs', extra: { createdBy: 'acct-ffffffffffffffff' } },
  { id: 'owners' },
  { id: 'guide' },
] }
const owned = ownedDocumentIds(workspace, ACCOUNT)

describe('visitor mode', () => {
  it('reads ownership from gardend\'s workspace rows', () => {
    expect([...owned].sort()).toEqual(['mine', 'mine-deep', 'moved-out'])
  })

  it('owns only its documents inside the fence', () => {
    expect(visitorOwns(sections, 'cow-tools-guide', 'mine', writer, owned)).toBe(true)
    expect(visitorOwns(sections, 'cow-tools-guide', 'mine-deep', writer, owned)).toBe(true)
    expect(visitorOwns(sections, 'cow-tools-guide', 'theirs', writer, owned)).toBe(false)
    expect(visitorOwns(sections, 'cow-tools-guide', 'owners', writer, owned)).toBe(false)
    expect(visitorOwns(sections, 'cow-tools-guide', 'guide', writer, owned)).toBe(false)
    expect(visitorOwns(sections, 'cow-tools-guide', 'moved-out', writer, owned), 'moved out by the owner: read-only').toBe(false)
    expect(visitorOwns(sections, 'other-graph', 'mine', writer, owned)).toBe(false)
    expect(visitorOwns(sections, 'cow-tools-guide', 'mine', reader, owned)).toBe(false)
  })

  it('opens only its own documents for editing, never offering Make Editable', () => {
    const mine = visitorDocumentAccess(sections, 'cow-tools-guide', 'mine', writer, 'Moo', owned)
    expect(mine).toMatchObject({ readOnly: false, makeEditable: false })
    const guide = visitorDocumentAccess(sections, 'cow-tools-guide', 'guide', writer, 'Moo', owned)
    expect(guide.readOnly).toBe(true)
    expect(guide.makeEditable).toBe(false)
    expect(visitorDocumentAccess(sections, 'cow-tools-guide', 'guide', reader, 'Moo', owned).readOnlyLabel).toContain('sign in')
  })

  it('offers the sidebar only what gardend would take', () => {
    const say = (action: string, nodeId?: string, visitor = writer) =>
      visitorSidebarRefusal({ action, ...(nodeId ? { nodeId } : {}) } as never, sections, 'cow-tools-guide', visitor, 'Moo', owned)
    expect(say('new-document')).toBeNull()
    expect(say('new-document', undefined, reader)).toContain('Sign in')
    expect(say('new-folder')).not.toBeNull()
    expect(say('upload')).not.toBeNull()
    expect(say('rename', 'mine')).toBeNull()
    expect(say('delete', 'mine')).toBeNull()
    expect(say('rename', 'theirs')).not.toBeNull()
    expect(say('delete', 'guide')).not.toBeNull()
    expect(say('node-menu', 'owners')).not.toBeNull()
    expect(say('refresh')).toBeNull()
  })

  it('drags only its own documents, and only inside the fence', () => {
    const drop = (sourceId: string, parentId: string | null) =>
      visitorDropRefusal({ sourceId } as never, sections, 'cow-tools-guide', writer, parentId, owned)
    expect(drop('mine', 'moo-sub')).toBeNull()
    expect(drop('mine', 'elsewhere')).not.toBeNull()
    expect(drop('mine', null)).not.toBeNull()
    expect(drop('theirs', 'moo-sub')).not.toBeNull()
  })

  it('reads the fence gardend lists, and the ID token the site left (while it is fresh)', () => {
    expect(parseVisitorFences([{ graphId: 'g', folderId: 'f', account: ACCOUNT, name: 'Moo Fan', color: '#16a34a' }, { graphId: 'x' }]))
      .toEqual([{ graphId: 'g', folderId: 'f', account: ACCOUNT, name: 'Moo Fan', color: '#16a34a' }])
    const jwt = (exp: number) => `eyJhbGciOiJSUzI1NiJ9.${btoa(JSON.stringify({ exp })).replace(/=+$/, '')}.c2ln`
    const now = 1_800_000_000_000
    const fresh = jwt(now / 1000 + 3600)
    const storage = (value: unknown) => ({ getItem: (key: string) => (key === 'cow-tools.account.tokens' ? JSON.stringify(value) : null) })
    expect(readAccountIdToken('cow-tools.account.tokens', [storage({ id_token: fresh })], now)).toBe(fresh)
    expect(readAccountIdToken('cow-tools.account.tokens', [storage({ id_token: jwt(now / 1000 + 30) })], now), 'about to expire').toBeNull()
    expect(readAccountIdToken('cow-tools.account.tokens', [null, storage({ access_token: fresh })], now)).toBeNull()
    expect(readAccountIdToken(null, [storage({ id_token: fresh })], now)).toBeNull()
  })
})
