/**
 * The reader's image: an image a file names is shown only when that costs no request to anyone.
 *
 * - `data:image/…` (a DOCX's embedded pictures, an inline Markdown image) is drawn at once: the bytes are already here.
 * - `http(s)://…` is a placeholder naming the host, and loads only when the person clicks it (no remote fetch on open:
 *   a file must not be able to tell a stranger that it was read).
 * - anything else (a relative path, `blob:`, `file:`, `javascript:`) is said to be not included.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { NodeView } from '@tiptap/pm/view'

export function imageSourceKind(src: unknown): 'inline' | 'remote' | 'absent' {
  if (typeof src !== 'string') return 'absent'
  const value = src.trim()
  if (/^data:image\/(?:png|gif|jpe?g|webp|avif|bmp|svg\+xml)[;,]/i.test(value)) return 'inline'
  if (/^https?:\/\//i.test(value)) return 'remote'
  return 'absent'
}

function hostOf(src: string): string {
  try { return new URL(src).host } catch { return 'another site' }
}

export const ReaderImage = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  draggable: false,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    }
  },

  parseHTML() {
    return [{
      tag: 'img[src]',
      getAttrs: el => ({ src: (el as HTMLElement).getAttribute('src'), alt: (el as HTMLElement).getAttribute('alt'), title: (el as HTMLElement).getAttribute('title') }),
    }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ({ node }) => {
      const src = String(node.attrs.src ?? '')
      const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
      const kind = imageSourceKind(src)
      const dom = document.createElement('span')
      dom.className = 'hoja-reader-image'
      dom.dataset.source = kind
      dom.setAttribute('contenteditable', 'false')
      const picture = () => {
        const img = document.createElement('img')
        img.alt = alt
        img.referrerPolicy = 'no-referrer'
        img.decoding = 'async'
        img.loading = 'lazy'
        if (typeof node.attrs.title === 'string') img.title = node.attrs.title
        img.src = src
        return img
      }
      if (kind === 'inline') dom.appendChild(picture())
      else if (kind === 'remote') {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'hoja-reader-image-load'
        button.textContent = `Image from ${hostOf(src)}${alt ? ` (${alt})` : ''} · Show`
        button.title = src
        button.addEventListener('click', event => {
          event.preventDefault()
          dom.dataset.source = 'loaded'
          dom.replaceChildren(picture())
        })
        dom.appendChild(button)
      } else {
        dom.textContent = `[Image not included${alt ? `: ${alt}` : ''}]`
      }
      const view: NodeView = { dom, stopEvent: () => true, ignoreMutation: () => true }
      return view
    }
  },
})
