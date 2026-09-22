/**
 * REAL component test - mn-comment-popover floating comment surface.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import '../mn-comment-popover.js'
import type {
  MnCommentPopover,
  MnCommentPopoverDetail,
  MnCommentPopoverMoveDetail,
  MnCommentPopoverSaveDetail,
} from '../mn-comment-popover.js'

function sr(el: HTMLElement): ShadowRoot {
  return el.shadowRoot!
}

async function mount(setup?: (el: MnCommentPopover) => void): Promise<MnCommentPopover> {
  const el = document.createElement('mn-comment-popover') as MnCommentPopover
  el.comment = {
    id: 'comment-a',
    author: 'Vera',
    text: 'Check this claim.',
    createdAt: Date.now() - 60_000,
  }
  setup?.(el)
  document.body.appendChild(el)
  await el.updateComplete
  return el
}

describe('mn-comment-popover', () => {
  beforeEach(() => {
    document.body.replaceChildren()
  })

  it('registers and renders peek comment content and quote', async () => {
    const el = await mount(popover => {
      popover.mode = 'peek'
      popover.quotedText = 'Selected document text'
      popover.x = 120
      popover.y = 140
    })

    expect(customElements.get('mn-comment-popover')).toBeDefined()
    const popover = sr(el).querySelector('[data-comment-popover]') as HTMLElement
    expect(popover).not.toBeNull()
    expect(popover.className).toContain('peek')
    expect(popover.getAttribute('data-comment-id')).toBe('comment-a')
    expect(popover.textContent).toContain('Vera')
    expect(popover.textContent).toContain('Selected document text')
    expect(popover.textContent).toContain('Check this claim.')
  })

  it('emits close, focus, resolve, and delete intents in pinned mode', async () => {
    const el = await mount(popover => {
      popover.mode = 'pinned'
      popover.editable = true
    })
    const closed: MnCommentPopoverDetail[] = []
    const focused: MnCommentPopoverDetail[] = []
    const resolved: MnCommentPopoverDetail[] = []
    const deleted: MnCommentPopoverDetail[] = []
    el.addEventListener('mn-close', event => {
      closed.push((event as CustomEvent<MnCommentPopoverDetail>).detail)
    })
    el.addEventListener('mn-focus', event => {
      focused.push((event as CustomEvent<MnCommentPopoverDetail>).detail)
    })
    el.addEventListener('mn-resolve', event => {
      resolved.push((event as CustomEvent<MnCommentPopoverDetail>).detail)
    })
    el.addEventListener('mn-delete', event => {
      deleted.push((event as CustomEvent<MnCommentPopoverDetail>).detail)
    })

    ;(sr(el).querySelector('[data-comment-popover]') as HTMLElement).click()
    ;(sr(el).querySelector('.close') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.resolve') as HTMLButtonElement).click()
    ;(sr(el).querySelector('.delete') as HTMLButtonElement).click()

    const detail = {
      commentId: 'comment-a',
      comment: {
        id: 'comment-a',
        author: 'Vera',
        text: 'Check this claim.',
        createdAt: el.comment!.createdAt,
      },
    }
    expect(focused).toEqual([detail])
    expect(closed).toEqual([detail])
    expect(resolved).toEqual([detail])
    expect(deleted).toEqual([detail])
  })

  it('enters edit mode and emits save aliases with trimmed text', async () => {
    const el = await mount(popover => {
      popover.mode = 'pinned'
      popover.editable = true
    })
    const saves: MnCommentPopoverSaveDetail[] = []
    const modern: MnCommentPopoverSaveDetail[] = []
    el.addEventListener('mn-save', event => {
      saves.push((event as CustomEvent<MnCommentPopoverSaveDetail>).detail)
    })
    el.addEventListener('mn-comment-popover-save', event => {
      modern.push((event as CustomEvent<MnCommentPopoverSaveDetail>).detail)
    })

    ;(sr(el).querySelector('.comment-text') as HTMLElement).click()
    await el.updateComplete
    const textarea = sr(el).querySelector<HTMLTextAreaElement>('.textarea')!
    textarea.value = '  Updated comment  '
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))

    expect(saves).toEqual([
      {
        commentId: 'comment-a',
        comment: el.comment,
        text: 'Updated comment',
      },
    ])
    expect(modern).toEqual(saves)
  })

  it('starts editing new comments and keeps blank untouched comments open on blur', async () => {
    const el = await mount(popover => {
      popover.mode = 'pinned'
      popover.editable = true
      popover.startEditing = true
      popover.comment = { id: 'new-comment', author: 'Vera', text: '', createdAt: Date.now() }
    })
    await el.updateComplete
    const textarea = sr(el).querySelector<HTMLTextAreaElement>('.textarea')!
    expect(textarea).not.toBeNull()

    textarea.dispatchEvent(new FocusEvent('blur', { bubbles: true }))
    await el.updateComplete

    expect(sr(el).querySelector('.textarea')).not.toBeNull()
  })

  it('emits clamped move intents while dragging pinned popovers', async () => {
    const el = await mount(popover => {
      popover.mode = 'pinned'
      popover.x = 100
      popover.y = 120
    })
    const moves: MnCommentPopoverMoveDetail[] = []
    el.addEventListener('mn-move', event => {
      moves.push((event as CustomEvent<MnCommentPopoverMoveDetail>).detail)
    })

    sr(el).querySelector<HTMLElement>('.header')!.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 120,
    }))
    document.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 140,
      clientY: 150,
    }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

    expect(moves).toEqual([
      {
        commentId: 'comment-a',
        comment: el.comment,
        x: 140,
        y: 150,
      },
    ])
  })

  it('renders resolved badge and mobile bottom-sheet styling', async () => {
    const el = await mount(popover => {
      popover.mobile = true
      popover.mode = 'pinned'
      popover.comment = {
        id: 'comment-resolved',
        author: 'Vera',
        text: 'Done.',
        createdAt: Date.now(),
      }
    })
    el.commentResolved = true
    await el.updateComplete

    expect(el.hasAttribute('mobile')).toBe(true)
    expect(sr(el).querySelector('.resolved')?.getAttribute('aria-label')).toBe('Resolved')
    expect(sr(el).querySelector('.resolve')).toBeNull()
  })
})
