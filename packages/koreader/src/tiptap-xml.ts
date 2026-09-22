import { SaxesParser, type SaxesTagPlain } from 'saxes'
import type { ReaderBlock, ReaderBlockType, ReaderDocument, ReaderMark } from './model.js'

type ListKind = 'bullet' | 'numbered' | 'todo'

interface XmlTextNode {
  readonly kind: 'text'
  readonly value: string
}

interface XmlElementNode {
  readonly kind: 'element'
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly children: XmlNode[]
}

type XmlNode = XmlTextNode | XmlElementNode

interface BlockCandidate {
  readonly element: XmlElementNode
  readonly listKind?: ListKind
}

interface InlineProjection {
  readonly text: string
  readonly marks: readonly ReaderMark[]
}

const MAX_XML_BYTES = 8 * 1024 * 1024
const ROOT_NAME = 'sophia-reader-root'
const CONTAINER_ELEMENTS = new Set(['doc', 'document', 'fragment'])
const BLOCK_ELEMENTS = new Set([
  'blockquote',
  'codeblock',
  'heading',
  'horizontalrule',
  'image',
  'listitem',
  'math',
  'mathblock',
  'paragraph',
  'taskitem',
])

/**
 * Replace a hosted block projection with Garden's canonical TipTap XML
 * fragment. The XML is a fragment rather than a standalone document, so it is
 * parsed beneath an inert synthetic root.
 */
export function readerDocumentFromTiptapXml(
  document: ReaderDocument,
  tiptapXml: string,
): ReaderDocument {
  const root = parseXmlFragment(tiptapXml)
  const candidates = collectBlockCandidates(root.children)
  const blocks = candidates.map((candidate, index) => readerBlock(candidate, index))
  return { ...document, blocks }
}

function parseXmlFragment(xml: string): XmlElementNode {
  if (typeof xml !== 'string') throw new TypeError('TipTap XML must be a string')
  if (new TextEncoder().encode(xml).byteLength > MAX_XML_BYTES) {
    throw new TypeError(`TipTap XML exceeds ${MAX_XML_BYTES} bytes`)
  }

  const syntheticRoot: XmlElementNode = {
    kind: 'element',
    name: ROOT_NAME,
    attributes: {},
    children: [],
  }
  const stack: XmlElementNode[] = [syntheticRoot]
  const parser = new SaxesParser({ xmlns: false })

  parser.on('doctype', () => {
    throw new TypeError('TipTap XML must not contain a doctype')
  })
  parser.on('processinginstruction', () => {
    throw new TypeError('TipTap XML must not contain processing instructions')
  })
  parser.on('opentag', (tag: SaxesTagPlain) => {
    const element: XmlElementNode = {
      kind: 'element',
      name: tag.name,
      attributes: { ...tag.attributes },
      children: [],
    }
    stack.at(-1)?.children.push(element)
    stack.push(element)
  })
  parser.on('text', (value: string) => {
    if (value === '' || (/^\s+$/.test(value) && value.includes('\n'))) return
    stack.at(-1)?.children.push({ kind: 'text', value })
  })
  parser.on('cdata', (value: string) => {
    if (value !== '') stack.at(-1)?.children.push({ kind: 'text', value })
  })
  parser.on('closetag', () => {
    if (stack.length <= 1) throw new TypeError('TipTap XML closed its synthetic root')
    stack.pop()
  })

  try {
    parser.write(`<${ROOT_NAME}>${xml}</${ROOT_NAME}>`).close()
  } catch (error) {
    throw new TypeError(`Invalid TipTap XML: ${messageOf(error)}`, { cause: error })
  }

  const parsedRoot = syntheticRoot.children[0]
  if (parsedRoot?.kind !== 'element' || parsedRoot.name !== ROOT_NAME) {
    throw new TypeError('TipTap XML parser did not produce its synthetic root')
  }
  return parsedRoot
}

function collectBlockCandidates(
  nodes: readonly XmlNode[],
  inheritedListKind?: ListKind,
): BlockCandidate[] {
  const output: BlockCandidate[] = []
  for (const node of nodes) {
    if (node.kind !== 'element') continue
    const name = normalizeName(node.name)
    if (CONTAINER_ELEMENTS.has(name)) {
      output.push(...collectBlockCandidates(node.children, inheritedListKind))
    } else if (name === 'bulletlist') {
      output.push(...collectBlockCandidates(node.children, 'bullet'))
    } else if (name === 'orderedlist') {
      output.push(...collectBlockCandidates(node.children, 'numbered'))
    } else if (name === 'tasklist') {
      output.push(...collectBlockCandidates(node.children, 'todo'))
    } else if (BLOCK_ELEMENTS.has(name)) {
      output.push({
        element: node,
        ...(name === 'listitem' || name === 'taskitem'
          ? { listKind: listKind(node, inheritedListKind) }
          : {}),
      })
    } else {
      const nested = collectBlockCandidates(node.children, inheritedListKind)
      if (nested.length > 0) output.push(...nested)
      else if (inlineProjection(node).text !== '') output.push({ element: node })
    }
  }
  return output
}

function readerBlock(candidate: BlockCandidate, index: number): ReaderBlock {
  const { element } = candidate
  const name = normalizeName(element.name)
  const inline = inlineProjection(element)
  const id = firstAttribute(element, 'data-block-id', 'dataBlockId', 'id')
    ?? `xml-block-${index + 1}`
  const type = blockType(name, candidate.listKind)
  const indent = integerAttribute(element, 'indent')
  const level = type === 'heading'
    ? clamp(integerAttribute(element, 'level') ?? 1, 1, 6)
    : type === 'bullet' || type === 'numbered'
      ? clamp((indent ?? 0) + 1, 1, 6)
      : undefined

  return {
    id,
    type,
    text: inline.text,
    order: index,
    marks: inline.marks,
    ...(level === undefined ? {} : { level }),
    ...(type === 'todo' ? { checked: booleanAttribute(element, 'checked') ?? false } : {}),
    ...(type === 'code'
      ? optionalField('language', firstAttribute(element, 'language', 'lang'))
      : {}),
    ...(type === 'image'
      ? {
          ...optionalField('imageSrc', firstAttribute(element, 'src')),
          ...optionalField('altText', firstAttribute(element, 'alt', 'title')),
        }
      : {}),
  }
}

function inlineProjection(element: XmlElementNode): InlineProjection {
  let text = ''
  const marks: ReaderMark[] = []

  const appendNode = (node: XmlNode, parentIsBlock: boolean): void => {
    if (node.kind === 'text') {
      text += node.value
      return
    }

    const name = normalizeName(node.name)
    const isBlock = BLOCK_ELEMENTS.has(name)
      || name === 'bulletlist'
      || name === 'orderedlist'
      || name === 'tasklist'
    if (parentIsBlock && isBlock && text !== '' && !text.endsWith('\n')) text += '\n'

    const mark = markForElement(node)
    const start = text.length
    for (const child of node.children) appendNode(child, isBlock)
    const end = text.length
    if (mark && end > start) marks.push({ ...mark, start, end })
  }

  for (const child of element.children) appendNode(child, true)
  return {
    text: text.replace(/^\n+|\n+$/g, ''),
    marks: marks.sort(compareMarks),
  }
}

function markForElement(
  element: XmlElementNode,
): Omit<ReaderMark, 'start' | 'end'> | undefined {
  const name = normalizeName(element.name)
  switch (name) {
    case 'bold':
    case 'strong':
      return { type: 'bold' }
    case 'em':
    case 'italic':
      return { type: 'italic' }
    case 'underline':
      return { type: 'underline' }
    case 'strike':
    case 'strikethrough':
      return { type: 'strike' }
    case 'code':
    case 'codeblock':
      return { type: 'code' }
    case 'highlight':
      return { type: 'highlight' }
    case 'link':
      return {
        type: 'link',
        ...optionalField('href', firstAttribute(element, 'href')),
        ...optionalField('label', firstAttribute(element, 'title', 'label')),
      }
    case 'wikilink':
      return {
        type: 'wikilink',
        ...optionalField(
          'targetDocumentId',
          firstAttribute(element, 'targetDocumentId', 'targetDocId', 'target-doc-id'),
        ),
        ...optionalField('href', firstAttribute(element, 'href')),
        ...optionalField('label', firstAttribute(element, 'title', 'label')),
      }
    case 'textstyle':
      return { type: 'textStyle' }
    default:
      return undefined
  }
}

function blockType(name: string, inheritedListKind?: ListKind): ReaderBlockType {
  switch (name) {
    case 'heading':
      return 'heading'
    case 'blockquote':
      return 'quote'
    case 'codeblock':
      return 'code'
    case 'horizontalrule':
      return 'divider'
    case 'image':
      return 'image'
    case 'math':
    case 'mathblock':
      return 'math'
    case 'taskitem':
      return 'todo'
    case 'listitem':
      return inheritedListKind ?? 'bullet'
    default:
      return 'paragraph'
  }
}

function listKind(element: XmlElementNode, inherited?: ListKind): ListKind {
  if (normalizeName(element.name) === 'taskitem') return 'todo'
  const declared = firstAttribute(element, 'listType', 'list-type')?.toLowerCase()
  if (declared === 'ordered' || declared === 'numbered') return 'numbered'
  if (declared === 'task' || declared === 'todo') return 'todo'
  if (declared === 'bullet') return 'bullet'
  return inherited ?? 'bullet'
}

function firstAttribute(element: XmlElementNode, ...names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = element.attributes[name]
    if (value !== undefined && value !== '' && value !== 'null') return value
  }
  return undefined
}

function integerAttribute(element: XmlElementNode, name: string): number | undefined {
  const raw = firstAttribute(element, name)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isInteger(value) ? value : undefined
}

function booleanAttribute(element: XmlElementNode, name: string): boolean | undefined {
  const raw = firstAttribute(element, name)?.toLowerCase()
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}

function optionalField<Key extends string>(
  key: Key,
  value: string | undefined,
): { readonly [Property in Key]?: string } {
  return value === undefined
    ? {}
    : { [key]: value } as { [Property in Key]: string }
}

function normalizeName(value: string): string {
  return value.includes(':') ? value.slice(value.lastIndexOf(':') + 1).toLowerCase() : value.toLowerCase()
}

function compareMarks(left: ReaderMark, right: ReaderMark): number {
  return left.start - right.start
    || right.end - right.start - (left.end - left.start)
    || left.type.localeCompare(right.type)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
