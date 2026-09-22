import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import '@shrubbery/components'
import type { MnPublicShell } from '@shrubbery/components'
import {
  attachPublicShellController,
  detectPublicRoute,
  fetchPublicWorkspaceBlob,
  loadPublicWorkspaceSnapshot,
  mountPublicShellRoute,
  projectPublicWireBundle,
  readPublicDocument,
  readPublicWorkspaceProjection,
  resolvePublicRoute,
  type PublicShellTransport,
} from '../public-shell.js'

function encodeDoc(doc: Y.Doc): Uint8Array {
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

function xmlText(parts: Array<{ text: string; attrs?: Record<string, unknown> }>): Y.XmlText {
  const node = new Y.XmlText()
  let index = 0
  for (const part of parts) {
    node.insert(index, part.text, part.attrs)
    index += part.text.length
  }
  return node
}

function xmlElement(
  name: string,
  attrs: Record<string, string> = {},
  children: Array<Y.XmlElement | Y.XmlText> = [],
): Y.XmlElement {
  const node = new Y.XmlElement(name)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  if (children.length) node.insert(0, children)
  return node
}

function workspaceBlob(): Uint8Array {
  const doc = new Y.Doc()
  const folders = doc.getMap<Y.Map<unknown>>('folders')
  const docs = doc.getMap<Y.Map<unknown>>('documents')

  const notes = new Y.Map<unknown>()
  notes.set('name', 'Notes')
  notes.set('section', 'documents')
  notes.set('order', 1)
  folders.set('urn:mnemosyne:user:u1:graph:graph-public:folder:folder-notes', notes)

  const artifactFolder = new Y.Map<unknown>()
  artifactFolder.set('name', 'Files')
  artifactFolder.set('section', 'artifacts')
  artifactFolder.set('order', 2)
  folders.set('urn:mnemosyne:user:u1:graph:graph-public:folder:folder-files', artifactFolder)

  const home = new Y.Map<unknown>()
  home.set('title', 'Welcome')
  home.set('order', 0)
  home.set('updatedAt', 1782216000000)
  docs.set('urn:mnemosyne:user:u1:graph:graph-public:doc:doc-home#block-ignored', home)

  const note = new Y.Map<unknown>()
  note.set('title', 'Wire notes')
  note.set('parentId', 'urn:mnemosyne:user:u1:graph:graph-public:folder:folder-notes')
  note.set('order', 1)
  docs.set('urn:mnemosyne:user:u1:graph:graph-public:doc:doc-notes', note)

  return encodeDoc(doc)
}

function documentBlob(title = 'Public brief'): Uint8Array {
  const doc = new Y.Doc()
  doc.getMap<unknown>('meta').set('updatedAt', '2026-06-23T12:00:00Z')
  const content = doc.getXmlFragment('content')

  const wikilink = xmlElement('wikilink', {
    label: 'Wire notes',
    targetDocId: 'urn:mnemosyne:user:u1:graph:graph-public:doc:doc-notes#block-target',
  })
  const paragraph = xmlElement('paragraph', { 'data-block-id': 'block-body' }, [
    xmlText([
      { text: 'Read ' },
      { text: 'linked', attrs: { bold: true } },
      { text: ' ' },
    ]),
    wikilink,
    xmlText([
      { text: ' source', attrs: { link: { href: 'https://sophia-labs.com' } } },
      { text: ' big', attrs: { textStyle: { fontSize: '18px' } } },
    ]),
  ])

  const table = xmlElement('table', { 'data-block-id': 'block-table' }, [
    xmlElement('tableRow', {}, [
      xmlElement('tableHeader', {}, [xmlElement('paragraph', {}, [xmlText([{ text: 'Name' }])])]),
      xmlElement('tableCell', { colspan: '2' }, [xmlElement('paragraph', {}, [xmlText([{ text: 'Sophia' }])])]),
    ]),
  ])

  content.insert(0, [
    xmlElement('heading', { 'data-block-id': 'block-title', level: '2' }, [xmlText([{ text: title }])]),
    paragraph,
    xmlElement('bulletList', {}, [
      xmlElement('listItem', { 'data-block-id': 'block-list', indent: '1' }, [
        xmlElement('paragraph', {}, [xmlText([{ text: 'Nested bullet' }])]),
      ]),
    ]),
    table,
    xmlElement('codeBlock', { 'data-block-id': 'block-code', language: 'ts' }, [
      xmlText([{ text: 'const publicGraph = true' }]),
    ]),
  ])

  return encodeDoc(doc)
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function bytesResponse(value: Uint8Array, status = 200): Response {
  const body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
  return new Response(body, { status })
}

describe('public-shell adapter', () => {
  it('projects a public workspace blob into controlled nav data', () => {
    const projection = readPublicWorkspaceProjection('graph-public', workspaceBlob())

    expect(projection.nav).toMatchObject({
      graphId: 'graph-public',
      folders: [{ id: 'folder-notes', label: 'Notes', order: 1 }],
      documents: [
        { id: 'doc-home', title: 'Welcome', order: 0 },
        { id: 'doc-notes', title: 'Wire notes', parentId: 'folder-notes', order: 1 },
      ],
    })
    expect(projection.nav.folders?.map((folder) => folder.id)).not.toContain('folder-files')
    expect(projection.rawDocumentIdsByNormalized.get('doc-home')).toBe(
      'urn:mnemosyne:user:u1:graph:graph-public:doc:doc-home#block-ignored',
    )
  })

  it('projects public document blobs into blocks and inline marks', () => {
    const doc = readPublicDocument('urn:mnemosyne:user:u1:graph:graph-public:doc:doc-home', documentBlob(), 'Welcome')

    expect(doc.id).toBe('doc-home')
    expect(doc.title).toBe('Welcome')
    expect(doc.updatedAt).toBe('2026-06-23T12:00:00Z')
    expect(doc.blocks?.map((block) => block.type)).toEqual(['heading', 'paragraph', 'bullet', 'table', 'code'])

    const paragraph = doc.blocks?.find((block) => block.id === 'block-body')
    expect(paragraph?.content).toBe('Read linked [[Wire notes]] source big')
    expect(paragraph?.marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'bold', start: 5, end: 12 }),
        expect.objectContaining({ type: 'wikilink', targetDocumentId: 'doc-notes', label: 'Wire notes' }),
        expect.objectContaining({ type: 'link', href: 'https://sophia-labs.com' }),
        expect.objectContaining({ type: 'fontSize', size: '18px' }),
      ]),
    )

    const bullet = doc.blocks?.find((block) => block.id === 'block-list')
    expect(bullet).toMatchObject({ type: 'bullet', content: 'Nested bullet', level: 1 })

    const table = doc.blocks?.find((block) => block.id === 'block-table')
    expect(table?.rows?.[0]?.cells).toEqual([
      expect.objectContaining({ isHeader: true, content: 'Name' }),
      expect.objectContaining({ isHeader: false, content: 'Sophia', colspan: 2 }),
    ])
  })

  it('maps Garden public wire bundles to the component wire contract', () => {
    const wires = projectPublicWireBundle({
      wired_block_ids: ['urn:mnemosyne:local:document:doc-home#block-body'],
      outgoing_wires: [
        {
          id: 'wire-1',
          predicate_label: 'supports',
          other_document_id: 'urn:mnemosyne:user:u1:graph:g:doc:doc-notes',
          other_block_id: 'urn:mnemosyne:local:document:doc-notes#block-target',
          other_title: 'Wire notes',
          other_snippet: 'A related note',
          local_block_id: 'block-body',
        },
      ],
      incoming_wires: [],
    })

    expect(wires).toEqual({
      wiredBlockIds: ['body'],
      outgoing: [
        {
          id: 'wire-1',
          predicateLabel: 'supports',
          otherDocumentId: 'doc-notes',
          otherTitle: 'Wire notes',
          otherBlockId: 'target',
          otherSnippet: 'A related note',
          localBlockId: 'block-body',
        },
      ],
      incoming: [],
    })
  })

  it('uses injected fetch transport and public auth headers', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const transport: PublicShellTransport = {
      baseUrl: '/cell',
      fetch: (async (input, init) => {
        calls.push({ url: String(input), headers: new Headers(init?.headers) })
        return bytesResponse(workspaceBlob())
      }) as typeof fetch,
    }

    const blob = await fetchPublicWorkspaceBlob('graph-public', { alias: 'wiki' }, transport)

    expect(blob.byteLength).toBeGreaterThan(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/cell/documents/graph-public/workspace/blob')
    expect(calls[0].headers.get('X-Public-Alias')).toBe('wiki')
  })

  it('detects alias routes and falls back to legacy token routes', async () => {
    const stored = new Map<string, string>()
    const route = detectPublicRoute(new URL('https://example.test/public/wiki?public_token=tok&doc=doc-home'), {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    })

    expect(route).toMatchObject({
      segment: 'wiki',
      alias: 'wiki',
      token: 'tok',
      initialDocumentId: 'doc-home',
      tokenStrippedUrl: 'https://example.test/public/wiki?doc=doc-home',
    })
    expect(stored.get('mn-public-token:wiki')).toBe('tok')

    const aliasResolved = await resolvePublicRoute(route!, {
      baseUrl: '/cell',
      fetch: (async () => jsonResponse({ alias: 'wiki', graph_id: 'graph-public' })) as typeof fetch,
    })
    expect(aliasResolved).toEqual({
      graphId: 'graph-public',
      access: { alias: 'wiki' },
      initialDocumentId: 'doc-home',
      mode: 'alias',
    })

    const tokenResolved = await resolvePublicRoute(route!, {
      baseUrl: '/cell',
      fetch: (async () => jsonResponse({ detail: 'not found' }, 404)) as typeof fetch,
    })
    expect(tokenResolved).toEqual({
      graphId: 'wiki',
      access: { token: 'tok' },
      initialDocumentId: 'doc-home',
      mode: 'token',
    })
  })

  it('loads a workspace snapshot and drives the real controlled shell element', async () => {
    const docBlobs = new Map([
      ['doc-home', documentBlob('Public brief')],
      ['doc-notes', documentBlob('Notes brief')],
    ])
    const clipboardWrites: string[] = []
    const historyPushes: string[] = []
    const transport: PublicShellTransport = {
      baseUrl: '/cell',
      fetch: (async (input) => {
        const url = String(input)
        if (url.endsWith('/workspace/blob')) return bytesResponse(workspaceBlob())
        const docMatch = url.match(/\/documents\/graph-public\/([^/]+)\/blob$/)
        if (docMatch) return bytesResponse(docBlobs.get(decodeURIComponent(docMatch[1])) ?? documentBlob('Fallback'))
        if (url.includes('/wires/graph-public/document/doc-home/bundle')) {
          return jsonResponse({
            wired_block_ids: ['block-body'],
            outgoing_wires: [
              {
                id: 'wire-1',
                predicate_label: 'supports',
                other_document_id: 'doc-notes',
                other_title: 'Wire notes',
                local_block_id: 'block-body',
              },
            ],
            incoming_wires: [],
          })
        }
        return jsonResponse({ wired_block_ids: [], outgoing_wires: [], incoming_wires: [] })
      }) as typeof fetch,
    }

    const snapshot = await loadPublicWorkspaceSnapshot('graph-public', { alias: 'wiki' }, transport)
    expect(snapshot.document.title).toBe('Welcome')
    expect(snapshot.wires?.outgoing?.[0]?.otherDocumentId).toBe('doc-notes')

    const element = document.createElement('mn-public-shell') as MnPublicShell
    document.body.appendChild(element)
    const controller = attachPublicShellController(element, {
      graphId: 'graph-public',
      access: { alias: 'wiki' },
      transport,
      location: new URL('https://example.test/public/wiki'),
      history: {
        pushState: (_state: unknown, _unused: string, url?: string | URL | null) => {
          if (url) historyPushes.push(String(url))
        },
      },
      clipboard: {
        writeText: async (value: string) => {
          clipboardWrites.push(value)
        },
      },
    })

    await controller.ready
    await element.updateComplete

    expect(element.status).toBe('ready')
    expect(element.nav?.documents?.map((doc) => doc.id)).toEqual(['doc-home', 'doc-notes'])
    expect(element.document?.id).toBe('doc-home')
    expect(element.shadowRoot?.querySelector('.doc-title')?.textContent).toBe('Welcome')

    await controller.openDocument('doc-notes')
    await element.updateComplete

    expect(element.document?.id).toBe('doc-notes')
    expect(element.document?.title).toBe('Wire notes')
    expect(historyPushes.at(-1)).toBe('https://example.test/public/wiki?doc=doc-notes')

    element.dispatchEvent(new CustomEvent('mn-public-shell-copy-code', {
      detail: { blockId: 'block-code', content: 'const publicGraph = true' },
      bubbles: true,
      composed: true,
    }))
    await Promise.resolve()
    expect(clipboardWrites).toEqual(['const publicGraph = true'])

    controller.destroy()
    element.remove()
  })

  it('mounts the public route shell, strips one-time tokens, and loads the requested document', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const stored = new Map<string, string>()
    const historyReplaces: string[] = []
    const host = document.createElement('div')
    document.body.appendChild(host)

    const transport: PublicShellTransport = {
      baseUrl: '/cell',
      fetch: (async (input, init) => {
        const url = String(input)
        calls.push({ url, headers: new Headers(init?.headers) })
        if (url.endsWith('/public-aliases/wiki')) return jsonResponse({ alias: 'wiki', graph_id: 'graph-public' })
        if (url.endsWith('/workspace/blob')) return bytesResponse(workspaceBlob())
        if (url.endsWith('/documents/graph-public/doc-notes/blob')) return bytesResponse(documentBlob('Notes brief'))
        return jsonResponse({ wired_block_ids: [], outgoing_wires: [], incoming_wires: [] })
      }) as typeof fetch,
    }

    const mount = mountPublicShellRoute(host, {
      location: new URL('https://example.test/public/wiki?public_token=tok&doc=doc-notes'),
      history: {
        pushState: () => {},
        replaceState: (_state: unknown, _unused: string, url?: string | URL | null) => {
          if (url) historyReplaces.push(String(url))
        },
      },
      storage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
      },
      transport,
    })

    expect(mount).not.toBeNull()
    await mount!.ready
    await mount!.element.updateComplete

    expect(host.querySelector('mn-public-shell')).toBe(mount!.element)
    expect(mount!.element.status).toBe('ready')
    expect(mount!.element.document?.id).toBe('doc-notes')
    expect(mount!.element.document?.title).toBe('Wire notes')
    expect(stored.get('mn-public-token:wiki')).toBe('tok')
    expect(historyReplaces).toEqual(['https://example.test/public/wiki?doc=doc-notes'])
    expect(calls.find((call) => call.url.endsWith('/workspace/blob'))?.headers.get('X-Public-Alias')).toBe('wiki')

    mount!.destroy()
    host.remove()
  })
})
