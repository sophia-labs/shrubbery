/**
 * REAL component test — mn-comments-panel comments sidebar shell.
 *
 * NO MOCKS: mounts the real backend-free custom element and drives DOM events
 * through its shadow tree. Comment data is prop-injected; writes/navigation
 * leave as composed intents.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import '../mn-comments-panel.js'
import type {
  MnComment,
  MnCommentDetail,
  MnCommentEditDetail,
  MnCommentHoverDetail,
  MnCommentResolveDetail,
  MnCommentsPanel,
} from '../mn-comments-panel.js'

async function mount(setup?: (el: MnCommentsPanel) => void): Promise<MnCommentsPanel> {
  const el = document.createElement('mn-comments-panel') as MnCommentsPanel
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

const sr = (el: MnCommentsPanel) => el.shadowRoot!

const comments: readonly MnComment[] = [
  {
    id: 'comment-later',
    author: 'Vera',
    text: 'Second in document order.',
    quotedText: 'Later block',
    createdAt: Date.now() - 120_000,
    documentPosition: 20,
  },
  {
    id: 'comment-first',
    author: 'Sophia',
    text: 'First in document order.',
    quotedText: 'Earlier block',
    createdAt: Date.now() - 60_000,
    documentPosition: 3,
  },
  {
    id: 'comment-resolved',
    author: 'Vera',
    text: '',
    quotedText: 'Resolved block',
    createdAt: Date.now() - 30_000,
    documentPosition: 30,
    resolved: true,
  },
]

describe('mn-comments-panel — real custom element', () => {
  beforeAll(() => {
    expect(customElements.get('mn-comments-panel')).toBeDefined()
  })

  it('upgrades the configured Garden comments tag and renders an empty state without data', async () => {
    const el = await mount()
    expect(el.shadowRoot).not.toBeNull()
    expect(sr(el).querySelector('.header-title')?.textContent).toBe('Comments')
    expect(sr(el).querySelector('.empty-state-title')?.textContent).toBe('No comments yet')
    expect(sr(el).querySelector('.empty-state-description')?.textContent).toContain('to comment')
  })

  it('renders controlled comments in document order with unresolved count and resolved styling', async () => {
    const el = await mount((node) => {
      node.comments = comments
      node.hoveredCommentId = 'comment-first'
    })

    const cards = Array.from(sr(el).querySelectorAll<HTMLElement>('[data-comment-id]'))
    expect(cards.map((card) => card.getAttribute('data-comment-id'))).toEqual([
      'comment-first',
      'comment-later',
      'comment-resolved',
    ])
    expect(sr(el).querySelector('.header-count')?.textContent).toBe('2')
    expect(cards[0].classList.contains('hovered')).toBe(true)
    expect(cards[2].classList.contains('resolved')).toBe(true)
    expect(cards[2].querySelector('.comment-text')?.textContent?.trim()).toBe('(Click to add comment...)')
  })

  it('emits composed select, hover, resolve, delete, and edit intents', async () => {
    const el = await mount((node) => {
      node.comments = comments
    })
    const selected: MnCommentDetail[] = []
    const hovered: MnCommentHoverDetail[] = []
    const resolved: MnCommentResolveDetail[] = []
    const deleted: MnCommentDetail[] = []
    const edited: MnCommentEditDetail[] = []

    el.addEventListener('mn-comment-select', (event) => {
      selected.push((event as CustomEvent<MnCommentDetail>).detail)
    })
    el.addEventListener('mn-comment-hover', (event) => {
      hovered.push((event as CustomEvent<MnCommentHoverDetail>).detail)
    })
    el.addEventListener('mn-comment-resolve', (event) => {
      resolved.push((event as CustomEvent<MnCommentResolveDetail>).detail)
    })
    el.addEventListener('mn-comment-delete', (event) => {
      deleted.push((event as CustomEvent<MnCommentDetail>).detail)
    })
    el.addEventListener('mn-comment-edit', (event) => {
      edited.push((event as CustomEvent<MnCommentEditDetail>).detail)
    })

    const first = sr(el).querySelector<HTMLElement>('[data-comment-id="comment-first"]')!
    first.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, composed: true }))
    first.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, composed: true }))
    first.click()
    ;(first.querySelector('.resolve') as HTMLButtonElement).click()
    ;(first.querySelector('.delete') as HTMLButtonElement).click()
    ;(first.querySelector('.comment-text') as HTMLElement).click()
    await el.updateComplete
    const textarea = sr(el).querySelector<HTMLTextAreaElement>('textarea[data-edit-id="comment-first"]')!
    textarea.value = 'Edited comment'
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      composed: true,
    }))

    expect(hovered.map((item) => item.id)).toEqual(['comment-first', null])
    expect(selected[0]).toMatchObject({ id: 'comment-first' })
    expect(resolved[0]).toMatchObject({ id: 'comment-first', resolved: true })
    expect(deleted[0]).toMatchObject({ id: 'comment-first' })
    expect(edited[0]).toMatchObject({ id: 'comment-first', text: 'Edited comment' })
  })
})
