// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { rovingToolbar } from '../roving-toolbar.js'

function bar(html: string): HTMLElement {
  const el = document.createElement('div'); el.innerHTML = html; document.body.append(el); return el
}
const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

describe('rovingToolbar', () => {
  it('leaves exactly one Tab stop and moves with the arrows', () => {
    const el = bar('<button id=a>A</button><input id=s type=checkbox><button id=c>C</button>')
    rovingToolbar(el)
    const stops = () => [...el.querySelectorAll<HTMLElement>("button, input")].filter(e => e.tabIndex === 0).map(e => e.id)
    expect(stops()).toEqual(['a'])
    el.querySelector<HTMLElement>('#a')!.focus(); press(el.querySelector('#a')!, 'ArrowRight')
    expect(document.activeElement?.id).toBe('s')
    press(el.querySelector('#s')!, 'End')
    expect(document.activeElement?.id).toBe('c')
    expect(stops()).toEqual(['c'])
    press(el.querySelector('#c')!, 'ArrowRight')
    expect(document.activeElement?.id).toBe('a')
  })

  it('treats several roots as one toolbar', () => {
    const one = bar('<button id=x>X</button>'); const two = bar('<button id=y>Y</button>')
    rovingToolbar(one, two)
    expect([...document.querySelectorAll<HTMLElement>('#x, #y')].filter(e => e.tabIndex === 0).length).toBe(1)
    one.querySelector<HTMLElement>('#x')!.focus(); press(one.querySelector('#x')!, 'ArrowRight')
    expect(document.activeElement?.id).toBe('y')
  })

  it('keeps a text field its caret keys', () => {
    const el = bar('<button id=b>B</button><input id=t type=text>')
    rovingToolbar(el)
    el.querySelector<HTMLElement>('#t')!.focus()
    expect(press(el.querySelector('#t')!, 'ArrowLeft')).toBe(true)      // not prevented
    expect(document.activeElement?.id).toBe('t')
  })
})
