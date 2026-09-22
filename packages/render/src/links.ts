/**
 * links.ts — the AltLink set for a resource (computed ONCE, shared by all faces).
 *
 * The "Link-set parity" invariant (a tested acceptance gate): all four faces of
 * one resource advertise the SAME set of links. So the link set is computed here
 * from the resource model + RenderCtx, target-agnostically, and every face
 * renders that one set (turtle/json in metadata-or-headers terms, hypertext in
 * the in-body Navigate block + the HTTP Link header the conneg server emits).
 *
 * The link grammar (FAIR Signposting / RFC 8288): one URL grammar, four faces.
 *   - self        — THIS resource (negotiated, no extension)
 *   - alternate   — each OTHER face of THIS resource (the .ext-pinned URLs)
 *   - describedby — the .ttl RDF face (FAIR: machine description)
 *   - up          — the parent collection (omitted at the root)
 *   - item        — for a collection, each child resource (the catalog → packs)
 *   - collection  — for an item, its parent collection
 *
 * Pure: no DOM, no network.
 */

import { FLOW_TABLES } from './flow-vocab.js'
import { CONTENT_TYPE, FACE_EXT, type AltLink, type RenderTarget, type RenderCtx, type Resource } from './target.js'

/** The short bed-key of a record IRI — the last `:record:<sha>`, first 12 (mirrors MemoryWorld.shortId). */
function recordShortId(iri: string): string | null {
  const parts = iri.split(':record:')
  const sha = parts[parts.length - 1]
  return sha ? sha.slice(0, 12) : null
}

/** Build the absolute URL for a face of `path` (extension-pinned, or negotiated). */
export function faceUrl(ctx: RenderCtx, path: string, target?: RenderTarget): string {
  const base = ctx.baseUrl.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  if (!target) return `${base}${p}`
  // index resources serve as `{path}/index.{ext}`; we expose the pinned form as
  // `{path}.{ext}` which the conneg server maps the same way (explicit ext wins).
  return `${base}${p}.${FACE_EXT[target]}`
}

/**
 * ALL pinned faces of THIS resource as alternate links.
 *
 * Crucially this is FACE-INVARIANT: every face advertises the SAME alternate set
 * (all four `.ext` faces), so the Link set is identical regardless of which face
 * you are viewing — that is the parity invariant. (We do NOT drop "the current
 * face" — an agent on the .ttl still benefits from seeing the .ttl link, and
 * dropping it would make turtle's link set differ from markdown's.) The turtle
 * face is `describedby` (FAIR machine description); the rest are `alternate`.
 */
function alternateFaces(ctx: RenderCtx): AltLink[] {
  const faces: RenderTarget[] = ['hypertext', 'turtle', 'json', 'dom']
  return faces.map((t) => ({
    rel: t === 'turtle' ? ('describedby' as const) : ('alternate' as const),
    href: faceUrl(ctx, ctx.selfPath, t),
    type: CONTENT_TYPE[t],
    title: faceTitle(t),
  }))
}

function faceTitle(t: RenderTarget): string {
  switch (t) {
    case 'hypertext': return 'Markdown'
    case 'turtle': return 'RDF/Turtle'
    case 'json': return 'JSON-LD'
    case 'dom': return 'HTML'
  }
}

/**
 * The complete AltLink set for a resource as seen from `selfTarget`'s face.
 *
 * `self` always points at the negotiated (extensionless) URL. The alternates are
 * the other three faces; describedby is the turtle face; up/item/collection come
 * from the resource model + ctx. This is the set the parity test pins (modulo the
 * one `self` rel whose `type` is the face being rendered).
 */
export function linksFor(resource: Resource, selfTarget: RenderTarget, ctx: RenderCtx): AltLink[] {
  const links: AltLink[] = []

  // self — the negotiated resource, typed as the current face.
  links.push({
    rel: 'self',
    href: faceUrl(ctx, ctx.selfPath),
    type: CONTENT_TYPE[selfTarget],
    title: faceTitle(selfTarget),
  })

  // alternate / describedby — ALL pinned faces of THIS resource (face-invariant).
  links.push(...alternateFaces(ctx))

  // up — the parent collection (root resources have none).
  if (ctx.upPath) {
    links.push({ rel: 'up', href: faceUrl(ctx, ctx.upPath), type: CONTENT_TYPE.hypertext, title: 'Up' })
  }

  // item — a catalog collection advertises each child component page.
  if (resource.kind === 'catalog') {
    for (const c of resource.components) {
      links.push({
        rel: 'item',
        href: faceUrl(ctx, `${ctx.selfPath}/${c.tag}`),
        type: CONTENT_TYPE.hypertext,
        title: c.tag,
      })
    }
  }

  // item — the Emporium vocab catalogue advertises each vocab-pack page.
  if (resource.kind === 'vocab-catalog') {
    for (const v of resource.vocabs) {
      links.push({
        rel: 'item',
        href: faceUrl(ctx, `${ctx.selfPath}/${v.name}`),
        type: CONTENT_TYPE.hypertext,
        title: v.name,
      })
    }
  }

  // collection — a component / vocab-pack / subject / bouquet / run / knob item points back at its collection.
  if (
    (resource.kind === 'component' ||
      resource.kind === 'vocab-pack' ||
      resource.kind === 'mem-subject' ||
      resource.kind === 'mem-bouquet' ||
      resource.kind === 'walk-run' ||
      resource.kind === 'tn-knob') &&
    ctx.upPath
  ) {
    const title =
      resource.kind === 'vocab-pack'
        ? 'Emporium'
        : resource.kind === 'mem-subject'
          ? 'Plot'
          : resource.kind === 'mem-bouquet'
            ? 'Bouquet'
            : resource.kind === 'walk-run'
              ? 'Walk'
              : resource.kind === 'tn-knob'
                ? 'Greenhouse'
                : 'Catalog'
    links.push({ rel: 'collection', href: faceUrl(ctx, ctx.upPath), type: CONTENT_TYPE.hypertext, title })
  }

  // item — the WALK index advertises each run page.
  if (resource.kind === 'walk-index') {
    for (const r of resource.runs) {
      links.push({
        rel: 'item',
        href: faceUrl(ctx, `${ctx.selfPath}/${r.id}`),
        type: CONTENT_TYPE.hypertext,
        title: r.id,
      })
    }
  }

  // related — a WALK run links to the Plot BEDS it wrote (via its supersession
  // edges → the bed rootIds). The host supplies the plot path via ctx.plotPath
  // (the conneg server knows '/plot'); each edge's NEW record's lineage root keys
  // a bed. We surface one related link per distinct bed the run touched, so an
  // agent on a run can curl straight to the bed it produced (the cross-surface
  // join the whole design turns on). When ctx.plotPath is absent (e.g. a pure
  // unit render with no server), we omit them — never a fake link.
  if (resource.kind === 'walk-run' && ctx.plotPath) {
    const seen = new Set<string>()
    for (const e of resource.supersessionEdges) {
      const rootId = recordShortId(e.oldUrn) // the OLD record is the bed's lineage root
      if (!rootId || seen.has(rootId)) continue
      seen.add(rootId)
      links.push({
        rel: 'related',
        href: faceUrl(ctx, `${ctx.plotPath}/${rootId}`),
        type: CONTENT_TYPE.hypertext,
        title: `Plot bed ${rootId}`,
      })
    }
  }

  // item — THE GREENHOUSE index advertises each knob page (/tune/{id}).
  if (resource.kind === 'tn-greenhouse') {
    for (const k of resource.knobs) {
      links.push({
        rel: 'item',
        href: faceUrl(ctx, `${ctx.selfPath}/${k.id}`),
        type: CONTENT_TYPE.hypertext,
        title: k.title,
      })
    }
  }

  // related — a KNOB links to (a) the Plot bed it governs (a dial → the bed it tunes,
  // §6 cross-surface join), (b) the bench:Run that JUSTIFIES its value (the provenance
  // join), and (c) its own `?asof` knob-history lens (the past value the scrubber
  // re-renders). Absent ones are omitted, never faked.
  if (resource.kind === 'tn-knob') {
    if (resource.governsBed && ctx.tunePlotPath) {
      links.push({
        rel: 'related',
        href: faceUrl(ctx, `${ctx.tunePlotPath}/${resource.governsBed}`),
        type: CONTENT_TYPE.hypertext,
        title: 'The Plot bed this dial governs',
      })
    }
    if (resource.justifiedBy && ctx.benchRunPath) {
      links.push({
        rel: 'related',
        href: faceUrl(ctx, `${ctx.benchRunPath}/${resource.justifiedBy.replace(/^run\//, '')}`),
        type: CONTENT_TYPE.hypertext,
        title: 'The bench:Run that justifies it (the Ledger)',
      })
    }
    links.push({
      rel: 'related',
      href: `${faceUrl(ctx, ctx.selfPath)}?asof=2023-05-25`,
      type: CONTENT_TYPE.hypertext,
      title: 'As-of view (the knob-history lens)',
    })
  }

  // related — a FLOW BOARD advertises a per-table anchor into its own page
  // (the markdown face renders one `## <table>` section per table, so the
  // fragment is a real in-page target). `up` (= the graph, per the S5 brief)
  // comes from ctx.upPath via the generic branch above — the HOST names the
  // graph page; a pure unit render with no upPath omits it, never fakes it.
  // rel=related, not item: a table is a section of THIS page, not a child
  // resource with its own URL — and the Navigate curl block stays clean
  // (fragments are meaningless to curl).
  if (resource.kind === 'flow-board') {
    for (const spec of FLOW_TABLES) {
      links.push({
        rel: 'related',
        href: `${faceUrl(ctx, ctx.selfPath)}#${spec.ddl}`,
        type: CONTENT_TYPE.hypertext,
        title: `${spec.ddl} (${resource.board[spec.ddl].length} rows)`,
      })
    }
  }

  // item — the RHIZOME plot advertises each subject-bed page.
  if (resource.kind === 'mem-plot') {
    for (const s of resource.subjects) {
      links.push({
        rel: 'item',
        href: faceUrl(ctx, `${ctx.selfPath}/${s.rootId}`),
        type: CONTENT_TYPE.hypertext,
        title: s.topic,
      })
    }
  }

  // related — a subject advertises its `?asof` temporal lens as a first-class link
  // (the design's whole point: the as-of view is a navigable face of the bed).
  if (resource.kind === 'mem-subject') {
    links.push({
      rel: 'related',
      href: `${faceUrl(ctx, ctx.selfPath)}?asof=2023-05-25`,
      type: CONTENT_TYPE.hypertext,
      title: 'As-of view (temporal lens)',
    })
    // related — the REVERSE cross-surface join: a bed → the agentic run that minted
    // its head (the host supplies walkRunPath from the trace files). Mirrors the run's
    // rel=related → its beds, so the two surfaces link both ways at the HATEOAS layer.
    // Absent when no minting run is known (read-only bed) → omitted, never faked.
    if (ctx.walkRunPath) {
      links.push({
        rel: 'related',
        href: faceUrl(ctx, ctx.walkRunPath),
        type: CONTENT_TYPE.hypertext,
        title: 'Minted by run (the Walk)',
      })
    }
    // related — the DEEP-LINK to this bed's BOUQUET (the read-side constellation
    // reader). The Plot bed is the structural lineage view; the Bouquet is the
    // bloom (the answer + why + dispositions + entity links + evidence). The host
    // supplies bouquetPath so the in-shell Plot drill-down has a HATEOAS twin (no
    // island). Absent for a pure unit render → omitted, never faked.
    if (ctx.bouquetPath) {
      links.push({
        rel: 'related',
        href: faceUrl(ctx, ctx.bouquetPath),
        type: CONTENT_TYPE.hypertext,
        title: 'Open the Bouquet (constellation reader)',
      })
    }
  }

  // related — a BOUQUET links back to the SAME belief's Plot bed (the structural
  // lineage view) + the minting Walk run + its own `?asof` temporal lens. The
  // cross-surface joins the whole design turns on: a reader on the bloom can curl
  // straight to the lineage (the Plot bed) or the write-side (the Walk run). The
  // host supplies plotPath ('/plot') always for a bouquet, and walkRunPath when a
  // run minted the head; absent ones are omitted, never faked.
  if (resource.kind === 'mem-bouquet') {
    if (ctx.plotPath) {
      links.push({
        rel: 'related',
        href: faceUrl(ctx, `${ctx.plotPath}/${resource.rootId}`),
        type: CONTENT_TYPE.hypertext,
        title: 'The Plot bed (structural lineage)',
      })
    }
    if (ctx.walkRunPath) {
      links.push({
        rel: 'related',
        href: faceUrl(ctx, ctx.walkRunPath),
        type: CONTENT_TYPE.hypertext,
        title: 'Minted by run (the Walk)',
      })
    }
    links.push({
      rel: 'related',
      href: `${faceUrl(ctx, ctx.selfPath)}?asof=2023-05-25`,
      type: CONTENT_TYPE.hypertext,
      title: 'As-of view (temporal lens)',
    })
  }

  return links
}

/** Render the AltLink set as an RFC 8288 `Link` header value (the conneg server emits this). */
export function toLinkHeader(links: readonly AltLink[]): string {
  return links
    .map((l) => {
      const title = l.title ? `; title="${l.title.replace(/"/g, '\\"')}"` : ''
      return `<${l.href}>; rel="${l.rel}"; type="${l.type}"${title}`
    })
    .join(', ')
}
