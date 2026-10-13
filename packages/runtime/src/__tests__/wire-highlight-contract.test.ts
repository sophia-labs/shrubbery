/**
 * wire-highlight-contract.test.ts — the CSS selector and the code that writes
 * the attribute are one contract, and nothing was holding them together.
 *
 * THE BUG THIS EXISTS FOR. `_syncWireHighlight` marked the target block with
 * `el.toggleAttribute('data-wire-highlighted', on)`. `toggleAttribute` cannot
 * write a value; it produces `data-wire-highlighted=""`. The rule that paints
 * the highlight asks for `[data-wire-highlighted='true']`. An empty string does
 * not match `'true'`, so the highlight was stamped on precisely the right block
 * and rendered nothing — for hovering a wire card, for travelling along a wire,
 * for opening a block from global search, and for the graph panel's node focus.
 * Four features, one dead selector.
 *
 * WHY THE EXISTING TESTS COULD NOT SEE IT, and why this file is shaped the way
 * it is. happy-dom builds a DOM and answers structural questions; it has no
 * layout engine and applies no CSS. A test can therefore prove an attribute is
 * present and never discover that no rule matches it. The two older assertions
 * did exactly that, and worse — they asserted `.toBe('')`, pinning the broken
 * value as though it were the contract.
 *
 * So this file does the one thing that catches the whole class: it takes the
 * SELECTOR STRINGS OUT OF THE STYLESHEET, as text, and runs the real element
 * against them with `Element.matches`. No remembered value, no second copy of
 * the expectation to drift. If either side moves — the writer switches back to
 * a presence attribute, or someone edits the rule — these fail.
 *
 * This is the third bug of this exact shape found in a week (a dead
 * `.ProseMirror > table` selector; an unreachable icon fallback). The pattern
 * is always the same: CSS fails silently, and the test suite cannot evaluate a
 * cascade. Where a rule's selector is load-bearing, assert against the rule.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../editor-host.ts',
)

/** The stylesheet as text. Read from disk so the assertions below cannot
 *  quietly diverge from what actually ships. */
const source = readFileSync(HOST_SOURCE, 'utf8')

/** Pull a selector out of the source by a stable fragment of it, so the test
 *  fails loudly if the rule is deleted rather than silently passing. */
function selectorContaining(fragment: string): string {
  const line = source
    .split('\n')
    .map(entry => entry.trim())
    .find(entry => entry.startsWith('.editor-mount') && entry.includes(fragment))
  if (!line) {
    throw new Error(
      `wire-highlight-contract: no .editor-mount rule containing "${fragment}" — `
        + 'the rule was renamed or removed, and the highlight it paints is now dead.',
    )
  }
  return line.replace(/\s*\{$/, '')
}

describe('the wire-highlight attribute and the rule that paints it agree', () => {
  it("the highlight rule asks for a VALUE, and 'true' is what satisfies it", () => {
    const selector = selectorContaining("[data-wire-highlighted=")

    const highlighted = document.createElement('p')
    highlighted.setAttribute('data-block-id', 'block-a')
    highlighted.setAttribute('data-wire-highlighted', 'true')
    // `matches` needs only the attribute half of the descendant selector; the
    // ancestor part is structure this unit does not build.
    const attributePart = selector.slice(selector.indexOf('['))
    expect(highlighted.matches(attributePart)).toBe(true)
  })

  it('REGRESSION: toggleAttribute writes "" and the rule does NOT match it', () => {
    // The exact shape of the original bug, pinned so it cannot come back by
    // someone "simplifying" setAttribute into toggleAttribute.
    const selector = selectorContaining('[data-wire-highlighted=')
    const attributePart = selector.slice(selector.indexOf('['))

    const toggled = document.createElement('p')
    toggled.toggleAttribute('data-wire-highlighted', true)
    expect(toggled.getAttribute('data-wire-highlighted')).toBe('')
    expect(toggled.matches(attributePart)).toBe(false)
  })

  it('the DECORATION emits the value, and the host writes no DOM attribute at all', () => {
    // The writer moved. It used to be `setAttribute` in this host's
    // `_syncWireHighlight`; it is now a ProseMirror decoration in the kernel,
    // because an attribute written onto a node ProseMirror owns does not
    // survive that node being redrawn. Measured in the running app: the
    // attribute went 1 -> 0 across 1.5s while decoration-based drag handles
    // went 3 -> 3 through the same replacement.
    const decoration = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../editor-kernel/src/extensions/wire-decorations.ts'),
      'utf8',
    )
    // Names only here. The VALUE is asserted where it can be read off a real
    // rendered element — wire-highlight-survives-redraw.test.ts — rather than
    // by guessing at the source syntax that produces it, which is how this
    // assertion first broke (it assumed an object literal; the file assigns
    // through a bracket).
    expect(decoration).toContain('data-wire-highlighted')
    expect(decoration).toContain('data-wire-highlight-mode')

    // And the host must NOT go back to poking the DOM: that is the regression,
    // and it would look completely correct in every other test.
    for (const method of ['private _syncWireHighlight()', 'private _syncWireIndicators()']) {
      const sync = source.slice(source.indexOf(method))
      const body = sync.slice(0, sync.indexOf('\n  }'))
      expect(body).not.toContain('setAttribute(')
      expect(body).not.toContain('toggleAttribute(')
      expect(body).not.toContain('querySelectorAll(')
    }
    // The indicator attributes moved too — same mechanism, same failure.
    expect(decoration).toContain('data-block-wired')
    expect(decoration).toContain('data-wire-count')
  })

  it('the arrival pulse is keyed off its own mode attribute', () => {
    const selector = selectorContaining("[data-wire-highlight-mode='arrival']")
    const attributePart = selector.slice(selector.indexOf('['))

    const arrived = document.createElement('p')
    arrived.setAttribute('data-wire-highlight-mode', 'arrival')
    expect(arrived.matches(attributePart)).toBe(true)

    // A hover must NOT pick up the pulse — that split is the whole point of
    // having a mode at all.
    const hovered = document.createElement('p')
    hovered.setAttribute('data-wire-highlight-mode', 'hover')
    expect(hovered.matches(attributePart)).toBe(false)
  })

  it('every animation named in this file has a keyframes block behind it', () => {
    // An animation naming keyframes that do not exist is inert and silent —
    // the same failure mode as the dead selector, one level up.
    //
    // NOT a substring check. The first draft asserted
    // `source.toContain('animation: mn-wire-arrival-pulse')`, which a mutation
    // walked straight through: renaming the animation to
    // `mn-wire-arrival-pulse-typo` still CONTAINS the original string, so the
    // guard passed over a dangling reference. Names get extracted and compared
    // whole.
    const declared = new Set(
      Array.from(source.matchAll(/@keyframes\s+([\w-]+)/g), match => match[1]),
    )
    const referenced = Array.from(
      source.matchAll(/animation:\s*([\w-]+)\s/g),
      match => match[1],
    ).filter(name => name !== 'none')

    expect(declared).toContain('mn-wire-arrival-pulse')
    expect(referenced).toContain('mn-wire-arrival-pulse')
    const dangling = referenced.filter(name => !declared.has(name))
    expect(dangling).toEqual([])
  })
})
