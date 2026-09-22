/**
 * store.ts — SHELL-SIDE reactive store over the live EMPORIUM vocab catalogue,
 * mirroring organism's session-store.ts.
 *
 * It wraps the EmporiumClient (the live /emporium reader) in a tiny reactive
 * store the shell binds the DOM views to. The store:
 *   1. reads GET /emporium/vocabs (the catalogue rows), then
 *   2. eagerly reads each pack's golden contract so the CATALOGUE view can show a
 *      real class-count per pack (the list endpoint doesn't carry one) AND a
 *      requested pack-DETAIL view can render instantly from the cache.
 *
 * NO MOCKS / NO FAKED FALLBACK: a read error is surfaced verbatim in the store
 * state (status='error', error=<the real message>). The store never substitutes
 * a fake catalogue when the live read fails — the shell shows the real error.
 *
 * HOISTED from apps/organism/src/cell/emporium-store.ts (U10, the emporium
 * migration) — @shrubbery/source/emporium is the sole external
 * adapter-consumption convention; organism keeps its own copy in place (frozen
 * under active swarm ownership) but it no longer has an external consumer.
 *
 * This is SHELL state. The pure views (apps/emporium/src/vocab-views.ts, its
 * only external consumer) are handed finished VocabSummary[] / VocabPack
 * values; they never fetch.
 */

import type { VocabPack, VocabSummary } from '@shrubbery/render'
import { EmporiumClient, type EmporiumTransport } from './client.js'
import type { ShrubberyStore, StoreStatus, StoreState } from '@shrubbery/nucleus'

/**
 * Re-export the canonical nucleus StoreStatus under the local name
 * apps/emporium/shell.ts imports. Members are byte-identical; this keeps the
 * shell untouched while collapsing the duplicate union onto one source.
 */
export type EmporiumStatus = StoreStatus

/** A settled live read of the catalogue + every pack's golden contract. */
export interface EmporiumRead {
  /** The catalogue rows (GET /emporium/vocabs). */
  readonly vocabs: readonly VocabSummary[]
  /** Each pack's golden contract, keyed by name (GET /emporium/vocab/{name}/latest). */
  readonly packs: Readonly<Record<string, VocabPack>>
  /** Per-pack class count derived from the loaded packs (name → count). */
  readonly classCounts: Readonly<Record<string, number>>
  /** Wall-clock ms when this read completed. */
  readonly readAt: number
}

/**
 * The emporium store's settled state = the canonical async-load envelope
 * specialized to an EmporiumRead payload. Same {status,read,error} shape — now
 * expressed as nucleus StoreState<EmporiumRead>.
 */
export type EmporiumStoreState = StoreState<EmporiumRead>

export interface EmporiumStore extends ShrubberyStore<EmporiumRead> {
  /** Compatibility alias for existing shells; canonical store reads use get(). */
  getState(): EmporiumStoreState
}

export interface EmporiumStoreOptions {
  /** Transport to the cell's /emporium routes (browser: { baseUrl: '/cell' }). */
  readonly transport: EmporiumTransport
}

/** Read the catalogue + every pack's golden contract once (the full picture). */
export async function loadEmporiumFromCell(client: EmporiumClient): Promise<EmporiumRead> {
  const vocabs = await client.listVocabs()
  const packs: Record<string, VocabPack> = {}
  const classCounts: Record<string, number> = {}
  for (const v of vocabs) {
    const pack = await client.getVocab(v.name, 'latest', v)
    packs[v.name] = pack
    classCounts[v.name] = pack.classes.length
  }
  return { vocabs, packs, classCounts, readAt: Date.now() }
}

/** Build a shell-side emporium store over an EmporiumTransport. */
export function createEmporiumStore(opts: EmporiumStoreOptions): EmporiumStore {
  const client = new EmporiumClient(opts.transport)
  let state: EmporiumStoreState = { status: 'idle', read: null, error: null }
  const subs = new Set<(s: EmporiumStoreState) => void>()

  const set = (next: EmporiumStoreState): void => {
    state = next
    for (const cb of subs) cb(state)
  }

  const refresh = async (): Promise<void> => {
    set({ status: 'loading', read: state.read, error: null })
    try {
      const read = await loadEmporiumFromCell(client)
      set({ status: 'ready', read, error: null })
    } catch (e) {
      // Surface the REAL error verbatim — never fall back to a fake catalogue.
      set({ status: 'error', read: state.read, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    get: () => state,
    getState: () => state,
    subscribe(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    refresh,
  }
}
