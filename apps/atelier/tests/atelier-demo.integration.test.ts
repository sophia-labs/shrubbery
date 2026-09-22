/**
 * REAL INTEGRATION — THE LOCAL-N0 DEMO LOOP, end to end, NO MOCKS.
 *
 * This is the ATELIER demo (RUNG N0b): the CHAT alongside the CANVAS, both real,
 * both against ONE live gardend cell. It composes the EXACT production pieces the
 * atelier page wires — there is no second, divergent path:
 *
 *   CANVAS = the render loop (createSessionStore → loadConfigFromCell → renderWorkspace)
 *            over the cell's :ux:config, with startPoll re-reading it (the W0 loop).
 *   CHAT   = the local ChatService whose turnDriver is the DETERMINISTIC GROW-DRIVER
 *            (makeGrowTurnDriver over a real GrowCell port built by buildGrowCell —
 *            the SAME port the atelier shell builds), mounted via the real
 *            <sh-chat-host> + <sh-chat-panel>.
 *
 * THE DEMO: type "give me a top bar" through the chat's REAL composer (a keystroke
 * + Enter, exactly like the user) → the grow-driver calls the REAL grow() → assert
 *
 *   (a) THE CELL GREW: the cell's :ux:config gained region-top-bar (read back
 *       THROUGH the contract, the production read path).
 *   (b) THE CANVAS DOM GROWS: after the render-loop poll re-reads, the #host DOM
 *       has <header data-region="region-top-bar"><mn-top-bar> (null before).
 *   (c) THE CHAT shows the grow tool-call + ack: a 'grow_interface' tool-call
 *       (completed) bubble + the assistant ack text rendered in the real chat tree.
 *
 * It REQUIRES the real gardend binary (no-mock rule) — FAILS LOUDLY if absent. The
 * grow-driver is a REAL deterministic responder calling the REAL grow(); the real
 * LLM swap is C4 (Linux-gated), not exercised here.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { html, render } from 'lit'
import {
  minimalTextPanelConfig,
  serializeConfigToTriples,
  triplesToNT,
  type EditorScope,
} from '@shrubbery/nucleus'
import {
  assembleChatServices,
  makeGrowTurnDriver,
  mountChatHost,
  renderWorkspace,
  type ShChatHost,
} from '@shrubbery/runtime'
import type { ShChatPanel } from '@shrubbery/chat-kernel'
import {
  spawnGardend,
  createGraphAndSeedUxConfig,
  resolveGardendBin,
  type GardendCell,
} from '../src/cell/spawn-gardend.js'
import { createGardendContract, type GardendContract } from '../src/cell/gardend-contract.js'
import {
  createSessionStore,
  loadConfigFromCell,
  workspaceConfigStore,
  type SessionStore,
} from '../src/cell/session-store.js'
import { buildGrowCell } from '../src/chat-main.js'

const GRAPH_ID = 'shrubbery-atelier-demo'

const GARDEN_BIN = resolveGardendBin()
const BIN_PRESENT = existsSync(GARDEN_BIN)

const SEED_NT = triplesToNT(serializeConfigToTriples(minimalTextPanelConfig()))

/** Wait until a predicate holds (the chat store + the canvas poll both tick async). */
async function until(pred: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until() timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('REAL INTEGRATION — ATELIER LOCAL-N0 demo: type in the chat → the canvas grows', () => {
  let cell: GardendCell
  let contract: GardendContract
  let store: SessionStore

  beforeAll(async () => {
    if (!BIN_PRESENT) {
      throw new Error(
        `gardend binary not found at ${GARDEN_BIN}. This test REQUIRES the real binary ` +
          `(no-mock rule). Set GARDEN_BIN, or run the live cell: pnpm gardend:dev`,
      )
    }
    cell = await spawnGardend()
    await createGraphAndSeedUxConfig(cell, GRAPH_ID, SEED_NT)
    contract = createGardendContract({
      transport: {
        mcpUrl: cell.mcpUrl,
        healthUrl: `${cell.apiUrl}/health`,
        token: cell.token,
        origin: 'http://127.0.0.1',
      },
    })
  }, 60000)

  afterAll(async () => {
    if (store) store.stopPoll()
    if (cell) await cell.kill()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
  })

  it('(a)+(b)+(c) typing "give me a top bar" grows the cell, grows the canvas, and shows the grow tool-call + ack', async () => {
    // ── MOUNT THE CANVAS (the render loop over the live :ux:config) ──────────────
    // This is main.ts's loop, composed directly over the real spawned cell: a
    // session store that reads :ux:config and renders it into #host on every tick.
    const hostEl = document.createElement('div')
    hostEl.id = 'host'
    document.body.appendChild(hostEl)

    store = createSessionStore({ contract, graphId: GRAPH_ID })
    const configStore = workspaceConfigStore(store)
    store.subscribe((state) => {
      if (state.status === 'ready' && state.read) {
        const configState = configStore.get()
        if (configState.status !== 'ready' || !configState.read) {
          throw new Error(`workspace config store not ready: ${configState.status}`)
        }
        renderWorkspace(configState.read, { container: hostEl })
      }
    })
    await store.refresh()

    // BEFORE — the canvas shows the bare seed (one text panel), NO top bar.
    expect(hostEl.querySelector('header[data-region="region-top-bar"] mn-top-bar')).toBeNull()
    expect(hostEl.querySelector('.split-pane[data-region="region-center"] mn-card')).not.toBeNull()

    // ── MOUNT THE CHAT (the local ChatService + the GROW-DRIVER over the SAME cell) ─
    // Exactly the atelier shell's assembly: build the GrowCell port (buildGrowCell)
    // over the SAME contract, inject makeGrowTurnDriver as the turnDriver, mount the
    // real <sh-chat-host> (which mounts the real <sh-chat-panel>).
    const chatEl = document.createElement('div')
    chatEl.id = 'chat'
    document.body.appendChild(chatEl)

    const scope = (): EditorScope => ({
      centerMode: 'document',
      graphId: GRAPH_ID,
      documentId: null,
    })
    const growCell = buildGrowCell(contract)
    const svc = assembleChatServices(contract, scope, 'local', makeGrowTurnDriver(growCell, GRAPH_ID))
    const session = await svc.createSession({ title: 'atelier-demo-chat' })
    render(html`<div class="main">${mountChatHost(svc, session.id)}</div>`, chatEl)
    const chatHost = chatEl.querySelector('#sh-chat-host') as ShChatHost
    await chatHost.updateComplete
    await Promise.resolve()
    const panel = chatHost.panel as ShChatPanel
    await panel.updateComplete

    // ── TYPE THE DEMO PHRASE through the REAL composer (keystroke + Enter) ───────
    panel.draft = 'give me a top bar'
    await panel.updateComplete
    const hoja = panel.querySelector('hoja-editor[posture="composer"]') as HTMLElement & {
      updateComplete: Promise<boolean>
    }
    await hoja.updateComplete
    const composer = hoja.querySelector('.ProseMirror') as HTMLElement
    expect(composer).not.toBeNull()
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    // ── (c) THE CHAT shows the grow tool-call (completed) + the assistant ack ────
    await until(() => panel.querySelector('.tool-status-icon[data-status="completed"]') !== null)
    await panel.updateComplete
    expect(panel.querySelector('.tool-call-name')?.textContent).toContain('grow_interface')
    const assistantBubble = panel.querySelector('.message.assistant')
    expect(assistantBubble?.textContent).toContain('your interface just grew')
    // The user's phrase is in the tree too (the round-trip is real).
    expect(panel.querySelector('.message.user')?.textContent).toContain('give me a top bar')

    // ── (a) THE CELL GREW: read :ux:config back THROUGH the contract ─────────────
    const afterRead = await loadConfigFromCell(contract, GRAPH_ID)
    expect(afterRead.config.rootRegions).toContain('region-top-bar')
    // Additive: the seed content root is still first.
    expect(afterRead.config.rootRegions[0]).toBe('region-center')

    // ── (b) THE CANVAS DOM GROWS after the render-loop re-reads ──────────────────
    // The grow-driver wrote out-of-band to :ux:config; the canvas loop re-reads it
    // (refresh = exactly what startPoll does each tick) and the #host DOM grows.
    await store.refresh()
    await until(
      () => hostEl.querySelector('header[data-region="region-top-bar"] mn-top-bar') !== null,
    )
    expect(hostEl.querySelector('header[data-region="region-top-bar"] mn-top-bar')).not.toBeNull()
    // The seed text panel survives (additive — the grow added OTHER interface).
    expect(hostEl.querySelector('.split-pane[data-region="region-center"] mn-card')).not.toBeNull()
  })
})
