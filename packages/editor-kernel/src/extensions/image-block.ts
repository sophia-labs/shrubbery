/**
 * TipTap Image Block Extension
 *
 * Block-level void node for inline images in documents.
 * Images are stored in S3 and served via a stable proxy endpoint.
 *
 * Attributes:
 * - src: Stable proxy URL for the image
 * - alt: Alt text / description (also stored as RDF triple for agent access)
 * - title: Optional tooltip text
 *
 * Usage in TipTap:
 *   editor.chain().focus().insertImage({ src, alt }).run()
 *
 * XML representation:
 *   <image src="..." alt="..." data-block-id="block-xxx"/>
 *
 * DOM rendering uses a wrapper div so the wire dot (::before) works
 * — void elements like <img> can't have pseudo-elements.
 */

import { Node, mergeAttributes } from '@tiptap/core'

export interface ImageBlockOptions {
  HTMLAttributes: Record<string, unknown>
}

export type ImageSize = 'small' | 'medium' | 'large'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      insertImage: (attrs: { src: string; alt?: string; title?: string; size?: ImageSize }) => ReturnType
    }
  }
}

export const ImageBlock = Node.create<ImageBlockOptions>({
  name: 'image',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => {
          // Handle wrapper div: look for img child
          const img = element.tagName === 'IMG' ? element : element.querySelector('img')
          return img?.getAttribute('src') || element.getAttribute('src')
        },
        renderHTML: (attributes) => ({ src: attributes.src }),
      },
      alt: {
        default: '',
        parseHTML: (element) => {
          const img = element.tagName === 'IMG' ? element : element.querySelector('img')
          return img?.getAttribute('alt') || element.getAttribute('alt') || ''
        },
        renderHTML: (attributes) => ({ alt: attributes.alt }),
      },
      title: {
        default: null,
        parseHTML: (element) => {
          const img = element.tagName === 'IMG' ? element : element.querySelector('img')
          return img?.getAttribute('title') || element.getAttribute('title')
        },
        renderHTML: (attributes) =>
          attributes.title ? { title: attributes.title } : {},
      },
      size: {
        default: 'large' as ImageSize,
        parseHTML: (element) => element.getAttribute('data-size') || 'large',
        renderHTML: (attributes) => ({ 'data-size': attributes.size || 'large' }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
      },
      {
        // Backend/MCP sends as <image> element
        tag: 'image[src]',
      },
      {
        // Wrapper div from our own renderHTML
        tag: 'div.image-block',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    // Separate image-specific attrs from global attrs (data-block-id, etc.)
    const { src, alt, title, ...globalAttrs } = HTMLAttributes
    // Wrapper div gets global attrs (data-block-id) + class for wire dot support
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, globalAttrs, { class: 'image-block' }),
      [
        'img',
        {
          src,
          alt: alt || '',
          ...(title ? { title } : {}),
          draggable: 'false',
        },
      ],
    ]
  },

  addCommands() {
    return {
      insertImage:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          })
        },
    }
  },
})

export default ImageBlock
