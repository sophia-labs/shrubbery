import { afterEach, describe, expect, it } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import {
  DEFAULT_QUERY_BLOCK_ATTRS,
  createKernelEditor,
  kernelExtensions,
  normalizeQueryBlockAttrs,
  type QueryBlockRenderRequest,
  type QueryBlockRenderer,
} from '../index'

const editors: Editor[] = []

afterEach(() => {
  while (editors.length) editors.pop()?.destroy()
  document.body.innerHTML = ''
})

function mount(opts: Parameters<typeof createKernelEditor>[1] = {}): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = createKernelEditor(element, opts)
  editors.push(editor)
  return editor
}

function firstQueryBlock(editor: Editor) {
  const found: Array<{ node: import('@tiptap/pm/model').Node; pos: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'queryBlock') return true
    found.push({ node, pos })
    return false
  })
  return found[0] ?? null
}

describe('QueryBlock schema and command', () => {
  it('ships as a real block atom with stable block ids', () => {
    const schema = getSchema(kernelExtensions())
    expect(schema.nodes.queryBlock).toBeDefined()
    expect(schema.nodes.queryBlock.spec.atom).toBe(true)
    expect(Object.keys(schema.nodes.queryBlock.spec.attrs ?? {})).toContain('data-block-id')
  })

  it('inserts and HTML-round-trips the full Garden attribute contract', () => {
    const editor = mount()
    editor.commands.setContent('<p>before</p>')
    editor.commands.focus('end')
    expect(
      editor.commands.insertQueryBlock({
        comment: 'People',
        query: 'SELECT ?person WHERE { ?person a <urn:Person> }',
        displayMode: 'manual',
        visualization: 'network',
        maxRows: 42,
        collapsed: true,
      }),
    ).toBe(true)

    const block = firstQueryBlock(editor)
    expect(block?.node.attrs).toMatchObject({
      comment: 'People',
      displayMode: 'manual',
      visualization: 'network',
      maxRows: 42,
      collapsed: true,
    })
    expect(block?.node.attrs['data-block-id']).toMatch(/^block-[0-9a-f]{8}$/)

    const html = editor.getHTML()
    expect(html).toContain('<query-block')
    expect(html).toContain('data-query-block')

    const second = mount()
    second.commands.setContent(html)
    expect(firstQueryBlock(second)?.node.attrs).toMatchObject({
      comment: 'People',
      visualization: 'network',
      maxRows: 42,
      collapsed: true,
    })
  })

  it('normalizes legacy bar mode and clamps rows', () => {
    expect(
      normalizeQueryBlockAttrs({ visualization: 'bar', maxRows: 900, collapsed: 'true' }),
    ).toMatchObject({ visualization: 'vega', maxRows: 500, collapsed: true })
    expect(normalizeQueryBlockAttrs({ maxRows: 0 }).maxRows).toBe(1)
    expect(normalizeQueryBlockAttrs({ query: 1 }).query).toBe(DEFAULT_QUERY_BLOCK_ATTRS.query)
  })
})

describe('QueryBlock host renderer seam', () => {
  it('receives live graph/attrs and can update the durable node', () => {
    const requests: QueryBlockRenderRequest[] = []
    const renderer: QueryBlockRenderer = (target, request) => {
      requests.push(request)
      target.textContent = `QUERY:${request.graphId}`
      return {
        update(next) {
          requests.push(next)
          target.textContent = next.attrs.comment
        },
        destroy() {},
      }
    }
    const editor = mount({ renderQueryBlock: renderer, getGraphId: () => 'graph-a' })
    editor.commands.insertQueryBlock()

    expect(document.querySelector('.query-block')?.textContent).toBe('QUERY:graph-a')
    expect(requests[0]?.graphId).toBe('graph-a')
    requests[0]?.updateAttrs({ comment: 'Updated note' })
    expect(firstQueryBlock(editor)?.node.attrs.comment).toBe('Updated note')
    expect(document.querySelector('.query-block')?.textContent).toBe('Updated note')
  })

  it('renders a truthful query fallback when no host renderer is supplied', () => {
    const editor = mount()
    editor.commands.insertQueryBlock({ query: 'ASK { ?s ?p ?o }' })
    expect(document.querySelector('.query-block-fallback-label')?.textContent).toBe('SPARQL query')
    expect(document.querySelector('.query-block-fallback-query')?.textContent).toBe(
      'ASK { ?s ?p ?o }',
    )
  })
})
