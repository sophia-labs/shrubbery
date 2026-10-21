import { afterEach, describe, expect, it } from 'vitest'
import { chooseFrom, filterChoices, type ShChoiceDialog } from '../choice-dialog-element.js'

const DOCS = [
  { id: 'doc-notes', label: 'My notes on chapter I', sub: 'Freud / notes' },
  { id: 'doc-freud', label: 'The Interpretation of Dreams', sub: 'Freud' },
  { id: 'doc-maury', label: 'Maury, Le sommeil et les rêves', tag: 'Source' },
]

afterEach(() => {
  document.body.replaceChildren()
})

async function open(items = DOCS) {
  const chosen = chooseFrom(document, { heading: 'Embed in which document?', items })
  const el = document.querySelector('sh-choice-dialog') as ShChoiceDialog
  await el.updateComplete
  return { chosen, el, root: el.shadowRoot! }
}

describe('<sh-choice-dialog>', () => {
  it('filters by every word typed, across tag, label and path', () => {
    expect(filterChoices(DOCS, 'freud notes').map((d) => d.id)).toEqual(['doc-notes'])
    expect(filterChoices(DOCS, 'source').map((d) => d.id)).toEqual(['doc-maury'])
    expect(filterChoices(DOCS, '')).toBe(DOCS)
  })

  it('resolves to the one chosen with the keyboard, and goes away', async () => {
    const { chosen, el, root } = await open()
    const input = root.querySelector('input')!
    input.value = 'dreams'
    input.dispatchEvent(new Event('input'))
    await el.updateComplete
    expect([...root.querySelectorAll('li .label')].map((l) => l.textContent)).toEqual(['The Interpretation of Dreams'])
    root.querySelector('.dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(await chosen).toBe('doc-freud')
    expect(document.querySelector('sh-choice-dialog')).toBeNull()
  })

  it('resolves to null on Esc', async () => {
    const { chosen, root } = await open()
    root.querySelector('.dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(await chosen).toBeNull()
  })

  it('says so when there is nothing to choose from', async () => {
    const { root } = await open([])
    expect(root.querySelector('.empty')!.textContent).toBe('Nothing to choose from.')
  })
})
