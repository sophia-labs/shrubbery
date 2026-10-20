import { describe, expect, it } from 'vitest'
import '../reader-contents.js'
import type { MnReaderContents } from '../reader-contents.js'

async function mount(headings: { id: string; level: number; text: string }[], activeId = ''): Promise<MnReaderContents> {
  const el = document.createElement('mn-reader-contents')
  el.headings = headings
  el.activeId = activeId
  document.body.append(el)
  await el.updateComplete
  return el
}

describe('mn-reader-contents', () => {
  it('lists the headings in order, indented by level, the one in view marked', async () => {
    const el = await mount([{ id: 'a', level: 1, text: 'One' }, { id: 'b', level: 2, text: 'Two' }, { id: 'c', level: 1, text: 'Three' }], 'b')
    const buttons = [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.toc button')]
    expect(buttons.map(b => b.textContent?.trim())).toEqual(['One', 'Two', 'Three'])
    expect(buttons.map(b => b.getAttribute('aria-current'))).toEqual(['false', 'true', 'false'])
    const pads = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.toc li')].map(li => li.style.paddingLeft)
    expect(pads).toEqual(['0px', '12px', '0px'])
    el.remove()
  })
  it('says which heading was chosen', async () => {
    const el = await mount([{ id: 'a', level: 1, text: 'One' }, { id: 'b', level: 1, text: 'Two' }])
    const seen: string[] = []
    el.addEventListener('rd-contents-navigate', e => seen.push((e as CustomEvent<{ id: string }>).detail.id))
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.toc button')[1]!.click()
    expect(seen).toEqual(['b'])
    el.remove()
  })
  it('says so when there are no headings', async () => {
    const el = await mount([])
    expect(el.shadowRoot!.querySelector('.empty')?.textContent).toContain('no headings')
    el.remove()
  })
})
