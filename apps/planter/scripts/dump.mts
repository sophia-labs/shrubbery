#!/usr/bin/env -S pnpm exec tsx
/**
 * dump.mts — real-API TripleSource read -> fossil v1 file writer (U12, design
 * §7 / §2.6).
 *
 * Reads ANY named graph via ONE bound `TripleSource` — any `@shrubbery/source`
 * adapter the boot factory (`sourceFromBoot`, PlanterBootConfig — the SAME
 * flags a planter-server boot uses) can wire — and writes it to disk as a
 * fossil v1 provenance-headed `.nt` via `writeFossil`
 * (packages/source/src/node/fossil-io.ts): the header's capture testimony
 * comes from the read ITSELF (`graphIri` verbatim, `capturedAt = read.readAt`)
 * — no timestamp is ever fabricated at write time (the fossil doctrine,
 * nucleus triple-source invariant 7).
 *
 * Usage (PlanterBootConfig-shaped flags):
 *   pnpm --dir apps/planter dump -- --graph g1 --endpoint http://127.0.0.1:7090 \
 *     --adapter gardend-local --auth-mode dev --token $TOKEN --out fossils/g1.nt
 *
 *   pnpm --dir apps/planter dump -- --graph g1 --endpoint https://sparql.example/query \
 *     --adapter sparql --out fossils/g1.nt
 *
 * `--adapter` is REQUIRED and always wins (boot.ts's own refusal discipline —
 * this CLI never guesses against real infrastructure either). `--source`
 * overrides the fossil header's human-readable capture-source note (never a
 * secret); default: `"<adapter kind> <endpoint>"`.
 */

import {
  bootGraphIri,
  type PlanterAdapter,
  type PlanterAuth,
  type PlanterBootConfig,
  sourceFromBoot,
} from '@shrubbery/source'
import { writeFossil } from '@shrubbery/source/node'

interface Args {
  graph?: string
  owner?: string
  endpoint?: string
  adapter?: string
  authMode?: string
  token?: string
  out?: string
  graphIri?: string
  source?: string
  readPath?: string
}

function usage(): string {
  return [
    'Usage:',
    '  dump.mts --graph <id> --endpoint <url> --adapter <gardend-local|hosted-gateway|sparql|static-nt>',
    '           --out <path.nt> [--owner <typed-principal>] [--auth-mode dev --token <tok>]',
    '           [--graph-iri <iri>] [--source <note>]',
  ].join('\n')
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`dump: ${a} requires a value\n\n${usage()}`)
      return v
    }
    switch (a) {
      case '--graph':
        out.graph = next()
        break
      case '--owner':
        out.owner = next()
        break
      case '--endpoint':
        out.endpoint = next()
        break
      case '--adapter':
        out.adapter = next()
        break
      case '--auth-mode':
        out.authMode = next()
        break
      case '--token':
        out.token = next()
        break
      case '--out':
        out.out = next()
        break
      case '--graph-iri':
        out.graphIri = next()
        break
      case '--source':
        out.source = next()
        break
      case '--read-path':
        out.readPath = next()
        break
      default:
        throw new Error(`dump: unrecognized argument '${a}'\n\n${usage()}`)
    }
  }
  return out
}

/** Only 'dev' (bearer token) and 'none' are wired for THIS CLI's auth today —
 *  'cognito' needs a signed-in CognitoAuthSession, which a headless script
 *  cannot honestly fabricate; refuse rather than send a token-less request
 *  and call it Cognito. */
function authFrom(args: Args): PlanterAuth {
  const mode = args.authMode ?? 'none'
  if (mode === 'dev') {
    if (!args.token) throw new Error("dump: --auth-mode dev requires --token")
    return { mode: 'dev', token: args.token }
  }
  if (mode === 'none') return { mode: 'none' }
  throw new Error(
    `dump: --auth-mode '${mode}' is not wired for this CLI — pass 'dev' (bearer token) or 'none'. ` +
      "('cognito' needs a signed-in session a headless script cannot honestly fabricate.)",
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.graph) throw new Error(`dump: --graph is required\n\n${usage()}`)
  if (!args.endpoint) throw new Error(`dump: --endpoint is required\n\n${usage()}`)
  if (!args.out) throw new Error(`dump: --out <path> is required\n\n${usage()}`)
  if (!args.adapter) {
    throw new Error(
      'dump: --adapter is required (one of gardend-local, hosted-gateway, sparql, static-nt) — ' +
        "a wrong guess against real infrastructure is a lie; name it explicitly.\n\n" +
        usage(),
    )
  }

  const config: PlanterBootConfig = {
    endpoint: args.endpoint,
    graph: args.graph,
    ...(args.owner !== undefined ? { owner: args.owner } : {}),
    adapter: args.adapter as PlanterAdapter,
    auth: authFrom(args),
    ...(args.graphIri !== undefined ? { configGraphIri: args.graphIri } : {}),
    ...(args.readPath !== undefined ? { readPath: args.readPath as 'mcp' | 'sparql' } : {}),
  }

  const source = await sourceFromBoot(config)
  try {
    const graphIri = bootGraphIri(config)
    const read = await source.read(graphIri)
    const captureSource = args.source ?? `${source.description.kind} ${args.endpoint}`
    const header = await writeFossil(args.out, read, captureSource)
    console.log(
      `dump: wrote ${args.out} — <${header.graphIri}> ${read.tripleCount} triples ` +
        `@ ${new Date(header.capturedAt).toISOString()} (capturedAt=${header.capturedAt})`,
    )
  } finally {
    await source.close()
  }
}

main().catch((err) => {
  console.error(`dump: FAILED — ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
