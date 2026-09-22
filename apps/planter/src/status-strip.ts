/**
 * status-strip.ts — the persistent capture-age chip (design §3.3):
 *
 *   <span class="mn-kind" data-kind="testimony">read {age} ago · {kind} · {liveness}</span>
 *
 * The FIRST end-to-end consumer of kind.css (§4): `applyKind` (the sole
 * programmatic `[data-kind=…]` applier, `@shrubbery/tokens`) stamps the
 * `testimony` register on a real `.mn-kind` span, and the Chromium gate
 * (`scripts/planter-browser.mts`) asserts the COMPUTED style kind.css gives
 * it — not merely that the attribute exists.
 *
 * `formatAge` (nucleus `kinds/format.ts`) already renders its own "ago" /
 * "just now" / "in the future" suffix — so the chip text is composed as
 * `read {formatAge output} · {kind} · {liveness}` rather than literally
 * appending a second " ago" after it (which would read "read 3m ago ago").
 * This is a deliberate, documented reading of the design's illustrative
 * markup, not a drift from its intent: the SAME three testimony facts
 * (age, source kind, liveness), in the same order, through the same
 * formatter.
 *
 * Pure DOM construction — no network, no store. The host (`main.ts`) calls
 * `update()` on every settled read (ok/empty/error) — MED-2: when the read
 * that just settled FAILED, the testimony passed is the PRIOR good read
 * (`SourceState.read`'s "retained through later errors" rule), and the
 * caller marks it `stale: true` so it is never mistaken for a current read.
 *
 * MED-1: the chip also renders the ACTIVE poll interval (`pollMs`) — a
 * number for "this many ms between re-reads", or the literal `'none'` for a
 * source that declares 'poll'/'push' liveness (it is NOT static) yet no
 * interval resolved anywhere (no boot `pollMs`, no adapter
 * `suggestedPollMs`) — the confession the design requires rather than
 * silently behaving like a single read. Omit `pollMs` entirely for a
 * 'static' source (there is no poll concept to confess).
 *
 * `data-triple-count` / `data-read-at` / `data-stale` / `data-poll-ms` are
 * additional machine-readable hooks on the chip (never rendered as prose
 * alone) so the real-browser gate can observe a poll-driven re-render (a
 * real `sparql_update` bumping the count) without scraping prose.
 */

import { formatAge } from '@shrubbery/nucleus'
import { applyKind } from '@shrubbery/tokens'
import type { Testimony } from './testimony.js'

/** MED-1/MED-2 render options accompanying one testimony snapshot. */
export interface StatusStripOptions {
  /** True iff this testimony is a RETAINED prior read after a later failure
   *  (never the current state) — MED-2. */
  readonly stale?: boolean
  /** The active poll interval in ms; `'none'` confesses a 'poll'/'push'
   *  source with NO resolvable interval (MED-1); omit for 'static' sources. */
  readonly pollMs?: number | 'none'
}

export interface StatusStrip {
  readonly element: HTMLElement
  /** Render one testimony snapshot. `now` is injectable for deterministic tests. */
  update(testimony: Testimony | undefined, opts?: StatusStripOptions, now?: number): void
}

/** Build the strip's DOM. Not yet mounted — the caller appends `.element`. */
export function createStatusStrip(): StatusStrip {
  const el = document.createElement('div')
  el.className = 'planter-status-strip'

  const chip = document.createElement('span')
  chip.className = 'mn-kind'
  applyKind({ kind: 'testimony', target: chip })
  el.append(chip)

  const update = (
    testimony: Testimony | undefined,
    opts: StatusStripOptions = {},
    now: number = Date.now(),
  ): void => {
    if (!testimony) {
      chip.textContent = 'no read yet'
      chip.removeAttribute('data-triple-count')
      chip.removeAttribute('data-read-at')
      chip.removeAttribute('data-stale')
      chip.removeAttribute('data-poll-ms')
      return
    }
    const parts = [`read ${formatAge(testimony.readAt, now)}`, testimony.source, testimony.liveness]
    if (opts.pollMs === 'none') {
      parts.push('no poll interval — showing a single read')
    } else if (opts.pollMs !== undefined) {
      parts.push(`poll ${opts.pollMs}ms`)
    }
    const text = parts.join(' · ')
    chip.textContent = opts.stale ? `STALE — ${text}` : text
    chip.setAttribute('data-triple-count', String(testimony.tripleCount))
    chip.setAttribute('data-read-at', String(testimony.readAt))
    if (opts.stale) {
      chip.setAttribute('data-stale', 'true')
    } else {
      chip.removeAttribute('data-stale')
    }
    if (opts.pollMs !== undefined) {
      chip.setAttribute('data-poll-ms', String(opts.pollMs))
    } else {
      chip.removeAttribute('data-poll-ms')
    }
  }

  return { element: el, update }
}
