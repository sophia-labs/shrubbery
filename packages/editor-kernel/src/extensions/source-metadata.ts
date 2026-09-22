import { Extension } from '@tiptap/core'

const SOURCE_METADATA_TYPES = [
  'paragraph',
  'heading',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'image',
  'mathBlock',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
] as const

const SOURCE_METADATA_ATTRIBUTES = [
  'data-source-format',
  'data-source-approach',
  'data-source-page',
  'data-source-role',
  'data-source-id',
  'data-pdf-page',
  'data-pdf-role',
] as const

export interface SourceMetadataOptions {
  types: readonly string[]
}

export const SourceMetadata = Extension.create<SourceMetadataOptions>({
  name: 'sourceMetadata',

  addOptions() {
    return {
      types: SOURCE_METADATA_TYPES,
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types as string[],
        attributes: Object.fromEntries(
          SOURCE_METADATA_ATTRIBUTES.map((attribute) => [
            attribute,
            {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute(attribute),
              renderHTML: (attributes: Record<string, unknown>) => {
                const value = attributes[attribute]
                if (value === undefined || value === null || value === '') return {}
                return { [attribute]: String(value) }
              },
            },
          ]),
        ),
      },
    ]
  },
})

export default SourceMetadata
