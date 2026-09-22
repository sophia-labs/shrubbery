/**
 * editor-host-jump-characterization.test.ts — pins the document "click-to-type
 * jump" mechanism deterministically.
 *
 * THIS TEST CHARACTERIZES CURRENT BEHAVIOR — it is NOT asserting desired
 * behavior. It documents, with the REAL pure `computeHostVars`, WHY the
 * document-editor float is the stable-layout invariant's first retire-target.
 *
 * The invariant (docs/design/stable-layout-invariant.md, and positively
 * asserted for the core in
 * layout/__tests__/stable-layout-containment.fitness.test.ts): a content
 * surface receives a SOLVED rect and owns its overflow; it must NOT derive its
 * own position from live measurement. Surfaces UNDER the Surface engine obey
 * this by construction. The editor host does NOT — it is a legacy
 * accommodation (editor-host.ts header: the host "never self-establishes a
 * containing block", the old shell can't own its layout). It computes its float
 * position from `anchorRect = getBoundingClientRect()` and RE-measures on
 * `updated()`/`ResizeObserver`. So the float is a PURE FUNCTION OF THE MEASURED
 * ANCHOR: any interaction that moves the anchor moves the editor.
 *
 * The felt bug: clicking into the document focuses it, focus reflows the anchor
 * (editor chrome/toolbar appears, so the anchor's top drops and its height
 * shrinks), and because the float is recomputed from the moved anchor the
 * editor SNAPS to a new position — the "click-to-type jump".
 *
 * Below we feed `computeHostVars` two anchor rects — pre-interaction vs
 * post-focus-reflow (a realistic small delta: the anchor's top drops and its
 * height shrinks by the chrome band, same `.main` frame) — and assert the two
 * results DIFFER in `--editor-y`/`--editor-h`. That difference IS the jump,
 * demonstrated without a browser and without mocks.
 *
 * KEPT GREEN ON PURPOSE: it asserts what the code does TODAY (measurement-
 * derived float ⇒ vars move with the anchor), which is true right now. When the
 * editor becomes a SOLVED FACE under the Surface engine — receiving a solved
 * rect and owning its overflow, exactly like every leaf in the containment
 * fitness test — its position stops being a function of live measurement and
 * this coupling disappears. At that point this characterization should be
 * REPLACED by a "no reposition on interaction" assertion (the editor's box does
 * not change when focus reflows its surroundings). NO MOCKS: real pure function,
 * real literal rects.
 */
import { describe, expect, it } from 'vitest'
import { computeHostVars } from '../editor-host.js'

describe('editor-host float — click-to-type jump characterization (retire-target #1)', () => {
  it('repositions the editor when focus reflows the anchor (the measured-anchor coupling)', () => {
    // The `.main` frame is fixed across the interaction — only the anchor moves.
    const main = { left: 40, top: 60 }

    // PRE-interaction: the document anchor as measured before the click, no
    // editor chrome yet.
    const anchorBeforeFocus = { left: 250, top: 120, width: 900, height: 640 }

    // POST-focus reflow: clicking in focuses the editor, chrome/toolbar appears,
    // so the anchor's top drops by the chrome band and its height shrinks by the
    // same amount — a realistic small delta, same left/width.
    const CHROME_BAND = 44
    const anchorAfterFocus = {
      left: 250,
      top: 120 + CHROME_BAND,
      width: 900,
      height: 640 - CHROME_BAND,
    }

    const before = computeHostVars(anchorBeforeFocus, main)
    const after = computeHostVars(anchorAfterFocus, main)

    // THE JUMP: the float's y and h vars change purely because the measured
    // anchor moved — no layout intent changed, only that focus reflowed the box
    // the editor derives its own position from.
    expect(after).not.toEqual(before)
    expect(after['--editor-y']).not.toBe(before['--editor-y'])
    expect(after['--editor-h']).not.toBe(before['--editor-h'])

    // The delta is exactly the anchor's reflow, proving the float tracks live
    // measurement 1:1 (before: top 120-60=60, h 640; after: top 164-60=104, h 596).
    expect(before['--editor-y']).toBe('60px')
    expect(after['--editor-y']).toBe('104px')
    expect(before['--editor-h']).toBe('640px')
    expect(after['--editor-h']).toBe('596px')

    // x and w are untouched because the anchor's left/width did not move — the
    // editor jumps only along the axis the reflow actually shifted.
    expect(after['--editor-x']).toBe(before['--editor-x'])
    expect(after['--editor-w']).toBe(before['--editor-w'])
  })
})
