/**
 * model.ts — the `ovillo` graph, read into what the app shows.
 *
 * A pure codec over nucleus Triples (whichever TripleSource read them): the
 * pieces with their scores, renders, ledgers, bench runs and instruments, and
 * the playlists. It invents nothing: a property the graph does not state is
 * absent (undefined), never a default, and the views say so.
 *
 * Lenient where the contract leaves room: a URL-valued property (`ovl:audio`,
 * `ovl:peaks`, `ovl:energyTrace`, `ovl:receipt`) may be an IRI or a literal;
 * `dcterms:created` may be a date or a dateTime.
 */

import type { Term, Triple } from '@shrubbery/nucleus'
import type { MnEnergyLedger } from '@shrubbery/components/audio'
import { DCT_CREATED, DCT_TITLE, RDFS_COMMENT, RDFS_LABEL, RDF_TYPE, ovl } from './vocab.js'

export interface OvilloInstrument {
  readonly iri: string
  readonly title?: string
  readonly kind?: string
  readonly anatomy?: string
  readonly tuning?: string
}

export interface OvilloScore {
  readonly iri: string
  readonly format?: string
  readonly text?: string
  readonly sourceDigest?: string
  readonly repoPath?: string
  readonly generator?: string
}

export interface OvilloBenchRun {
  readonly iri: string
  readonly pattern?: string
  readonly pickup?: string
  /** The patch, as the JSON literal the graph carries. */
  readonly patch?: string
  readonly closureResidual?: number
  readonly safetyLimitedFrames?: number
}

export interface OvilloLedger extends MnEnergyLedger {
  readonly iri: string
}

export interface OvilloRender {
  readonly iri: string
  readonly audio?: string
  readonly audioDigest?: string
  readonly peaks?: string
  readonly energyTrace?: string
  readonly receipt?: string
  readonly durationSeconds?: number
  readonly renderDigest?: string
  readonly engineVersion?: string
  readonly worldPeakDbfs?: number
  readonly worldRmsDbfs?: number
  readonly pageGainDb?: number
  readonly wallSeconds?: number
  readonly eventCount?: number
  readonly sourceRevision?: string
  readonly created?: string
  readonly ledgers: readonly OvilloLedger[]
  readonly bench: OvilloBenchRun | null
}

export interface OvilloPiece {
  readonly iri: string
  readonly slug: string
  readonly title: string
  readonly group?: string
  readonly tags: readonly string[]
  readonly note?: string
  readonly engine?: string
  readonly position?: number
  readonly instruments: readonly OvilloInstrument[]
  readonly score: OvilloScore | null
  readonly render: OvilloRender | null
}

export interface OvilloPlaylist {
  readonly iri: string
  readonly title: string
  readonly comment?: string
  readonly items: readonly OvilloPiece[]
  /** True for the app's own "All pieces" list, which the graph does not state. */
  readonly derived: boolean
}

export interface OvilloGraph {
  readonly pieces: readonly OvilloPiece[]
  readonly playlists: readonly OvilloPlaylist[]
  readonly bySlug: ReadonlyMap<string, OvilloPiece>
  readonly byIri: ReadonlyMap<string, OvilloPiece>
  /** A playlist's rdfs:comment says FIXTURE: the graph is the app's stand-in, and the shell says so. */
  readonly fixture: boolean
  readonly tripleCount: number
}

export class NoPiecesError extends Error {
  constructor(readonly tripleCount: number) {
    super(`the graph has ${tripleCount} triples and no ovl:Piece`)
    this.name = 'NoPiecesError'
  }
}

/** The group order the gallery uses; any other group follows, by name. */
const GROUP_ORDER = ['today', 'repo', 'bench']

class Index {
  private readonly bySubject = new Map<string, Map<string, Term[]>>()

  constructor(triples: readonly Triple[]) {
    for (const t of triples) {
      let props = this.bySubject.get(t.s)
      if (!props) {
        props = new Map()
        this.bySubject.set(t.s, props)
      }
      const list = props.get(t.p)
      if (list) list.push(t.o)
      else props.set(t.p, [t.o])
    }
  }

  subjectsOfType(type: string): string[] {
    const out: string[] = []
    for (const [s, props] of this.bySubject) {
      if ((props.get(RDF_TYPE) ?? []).some((o) => o.type === 'iri' && o.value === type)) out.push(s)
    }
    return out.sort()
  }

  all(s: string, p: string): Term[] {
    return this.bySubject.get(s)?.get(p) ?? []
  }

  /** The one value (the lexically first, for determinism, if the graph states several). */
  one(s: string, p: string): Term | undefined {
    const terms = this.all(s, p)
    if (terms.length <= 1) return terms[0]
    return [...terms].sort((a, b) => a.value.localeCompare(b.value))[0]
  }

  text(s: string, p: string): string | undefined {
    const term = this.one(s, p)
    return term ? term.value : undefined
  }

  number(s: string, p: string): number | undefined {
    const term = this.one(s, p)
    if (term?.type !== 'literal') return undefined
    const n = Number(term.value)
    return Number.isFinite(n) ? n : undefined
  }

  iri(s: string, p: string): string | undefined {
    const term = this.one(s, p)
    return term?.type === 'iri' ? term.value : undefined
  }

  iris(s: string, p: string): string[] {
    return this.all(s, p).filter((o) => o.type === 'iri').map((o) => o.value).sort()
  }
}

function defined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}

export function parseOvillo(triples: readonly Triple[]): OvilloGraph {
  const g = new Index(triples)

  const instrument = (iri: string): OvilloInstrument =>
    defined({
      iri,
      title: g.text(iri, DCT_TITLE) ?? g.text(iri, RDFS_LABEL),
      kind: g.text(iri, ovl('kind')),
      anatomy: g.text(iri, ovl('anatomy')),
      tuning: g.text(iri, ovl('tuning')),
    })

  const score = (iri: string): OvilloScore =>
    defined({
      iri,
      format: g.text(iri, ovl('format')),
      text: g.text(iri, ovl('text')),
      sourceDigest: g.text(iri, ovl('sourceDigest')),
      repoPath: g.text(iri, ovl('repoPath')),
      generator: g.text(iri, ovl('generator')),
    })

  const ledger = (iri: string): OvilloLedger =>
    defined({
      iri,
      world: g.text(iri, ovl('world')) ?? iri.split('/').pop() ?? iri,
      anatomy: g.text(iri, ovl('anatomy')),
      planDigest: g.text(iri, ovl('planDigest')),
      plucks: g.number(iri, ovl('plucks')),
      hammerOns: g.number(iri, ovl('hammerOns')),
      pullOffs: g.number(iri, ovl('pullOffs')),
      slides: g.number(iri, ovl('slides')),
      sourceWork: g.number(iri, ovl('sourceWork')),
      controlWork: g.number(iri, ovl('controlWork')),
      internalLoss: g.number(iri, ovl('internalLoss')),
      radiation: g.number(iri, ovl('radiation')),
      closureResidual: g.number(iri, ovl('closureResidual')),
      maxFrameResidual: g.number(iri, ovl('maxFrameResidual')),
    })

  const bench = (iri: string): OvilloBenchRun =>
    defined({
      iri,
      pattern: g.text(iri, ovl('pattern')),
      pickup: g.text(iri, ovl('pickup')),
      patch: g.text(iri, ovl('patch')),
      closureResidual: g.number(iri, ovl('closureResidual')),
      safetyLimitedFrames: g.number(iri, ovl('safetyLimitedFrames')),
    })

  const render = (iri: string): OvilloRender => {
    const benchIri = g.iri(iri, ovl('bench'))
    return defined({
      iri,
      audio: g.text(iri, ovl('audio')),
      audioDigest: g.text(iri, ovl('audioDigest')),
      peaks: g.text(iri, ovl('peaks')),
      energyTrace: g.text(iri, ovl('energyTrace')),
      receipt: g.text(iri, ovl('receipt')),
      durationSeconds: g.number(iri, ovl('durationSeconds')),
      renderDigest: g.text(iri, ovl('renderDigest')),
      engineVersion: g.text(iri, ovl('engineVersion')),
      worldPeakDbfs: g.number(iri, ovl('worldPeakDbfs')),
      worldRmsDbfs: g.number(iri, ovl('worldRmsDbfs')),
      pageGainDb: g.number(iri, ovl('pageGainDb')),
      wallSeconds: g.number(iri, ovl('wallSeconds')),
      eventCount: g.number(iri, ovl('eventCount')),
      sourceRevision: g.text(iri, ovl('sourceRevision')),
      created: g.text(iri, DCT_CREATED),
      ledgers: g.iris(iri, ovl('ledger')).map(ledger).sort((a, b) => a.iri.localeCompare(b.iri)),
      bench: benchIri ? bench(benchIri) : null,
    })
  }

  const pieces: OvilloPiece[] = g.subjectsOfType(ovl('Piece')).map((iri) => {
    const scoreIri = g.iri(iri, ovl('score'))
    const renderIri = g.iri(iri, ovl('render'))
    return defined({
      iri,
      slug: g.text(iri, ovl('slug')) ?? iri.split('/').pop() ?? iri,
      title: g.text(iri, DCT_TITLE) ?? g.text(iri, ovl('slug')) ?? iri,
      group: g.text(iri, ovl('group')),
      tags: g.all(iri, ovl('tag')).map((t) => t.value).sort(),
      note: g.text(iri, ovl('note')),
      engine: g.text(iri, ovl('engine')),
      position: g.number(iri, ovl('position')),
      instruments: g.iris(iri, ovl('instrument')).map(instrument),
      score: scoreIri ? score(scoreIri) : null,
      render: renderIri ? render(renderIri) : null,
    })
  })
  if (pieces.length === 0) throw new NoPiecesError(triples.length)

  const groupRank = (group: string | undefined): number => {
    const i = group === undefined ? -1 : GROUP_ORDER.indexOf(group)
    return i === -1 ? GROUP_ORDER.length : i
  }
  const inOrder = (a: OvilloPiece, b: OvilloPiece): number =>
    (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)

  const byIri = new Map(pieces.map((p) => [p.iri, p]))
  const stated: OvilloPlaylist[] = g.subjectsOfType(ovl('Playlist')).map((iri) =>
    defined({
      iri,
      title: g.text(iri, DCT_TITLE) ?? iri,
      comment: g.text(iri, RDFS_COMMENT),
      items: g.iris(iri, ovl('item')).map((i) => byIri.get(i)).filter((p): p is OvilloPiece => !!p).sort(inOrder),
      derived: false,
    }),
  )
  // Stated playlists in the gallery's group order (a playlist named for a group sorts with it).
  const rankOf = (pl: OvilloPlaylist): number => {
    const groups = new Set(pl.items.map((p) => p.group))
    return groups.size === 1 ? groupRank([...groups][0]) : GROUP_ORDER.length
  }
  stated.sort((a, b) => rankOf(a) - rankOf(b) || a.title.localeCompare(b.title))
  const all: OvilloPlaylist = {
    iri: 'urn:ovillo:app:all-pieces',
    title: 'All pieces',
    items: [...pieces].sort((a, b) => groupRank(a.group) - groupRank(b.group) || (a.group ?? '').localeCompare(b.group ?? '') || inOrder(a, b)),
    derived: true,
  }
  const playlists = stated.length === 1 && stated[0].items.length === pieces.length ? stated : [...stated, all]

  return {
    pieces: all.items,
    playlists,
    bySlug: new Map(pieces.map((p) => [p.slug, p])),
    byIri,
    fixture: stated.some((pl) => /\bFIXTURE\b/.test(pl.comment ?? '')),
    tripleCount: triples.length,
  }
}
