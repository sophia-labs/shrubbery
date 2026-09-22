#!/usr/bin/env -S pnpm exec tsx
/**
 * seed.mts — real-API seed CLI (U12, design §7).
 *
 * Loads an N-Triples body — default: `@shrubbery/nucleus`'s own canonical
 * `garden-default.ux.nt` seed export — into a graph's `:ux:config` NAMED
 * graph, via `@shrubbery/source/node`'s proven MCP tool-call shapes. Two
 * write-target variants (`SeedTarget`, verbatim — seed.ts's own doc comment):
 *
 *   LOCAL (manifest discovery) — an ALREADY-RUNNING gardend cell:
 *     --profile-dir <dir>   read loopback.json there (default $GARDEN_PROFILE_DIR)
 *
 *   GATEWAY — POST {endpoint}/g/{graphId}/mcp with an Editor credential:
 *     --endpoint <url>  --auth-mode dev  --token <editor-token>
 *
 * Exactly one variant resolves. Under-specified or ambiguous flags REFUSE,
 * naming the missing field — no silent guess, no fallback config (the
 * boot-factory discipline this CLI shares in spirit).
 *
 * Seeding IS a write: on the gateway this correctly costs Editor
 * (POST /g/{id}/mcp uniformly requires Editor today — design §2.7).
 *
 * Two seed modes over the SAME target (design's "createGraphAndSeedUxConfig /
 * seedGraphFromNtFile" pairing):
 *   default        — create_graph THEN rdf_load (createGraphAndSeedUxConfig):
 *                    the graph must NOT already exist.
 *   --no-create    — rdf_load ONLY (seedGraphFromNtFile): the graph MUST
 *                    already exist (e.g. created empty by an earlier step) —
 *                    this is the "empty -> ready" transition a caller can
 *                    observe live against a running planter server.
 *
 * Usage:
 *   pnpm --dir apps/planter seed -- --graph planter-dev --profile-dir /tmp/gardend-xyz
 *   pnpm --dir apps/planter seed -- --graph g1 \
 *     --endpoint https://api.canary.sophia-labs.com --auth-mode dev --token $EDITOR_TOKEN
 *
 * Errors surface verbatim (McpError / TripleSourceError-shaped upstream
 * messages) — never swallowed, never laundered into a generic failure.
 */

import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import {
  createGraphAndSeedUxConfig,
  gatewaySeedTarget,
  loopbackSeedTarget,
  readLoopbackManifest,
  seedGraphFromNtFile,
  type SeedTarget,
} from '@shrubbery/source/node'

const require = createRequire(import.meta.url)

interface Args {
  graph?: string
  file?: string
  title?: string
  profileDir?: string
  endpoint?: string
  authMode?: string
  token?: string
  noCreate: boolean
}

function usage(): string {
  return [
    'Usage:',
    '  seed.mts --graph <id> [--file <path.nt>] [--title <t>] [--no-create]',
    '           (--profile-dir <dir> | --endpoint <url> --auth-mode dev --token <tok>)',
    '',
    'Exactly one of --profile-dir (local manifest discovery, or $GARDEN_PROFILE_DIR)',
    'or --endpoint (+ --auth-mode dev + --token, a gateway Editor write) must resolve.',
  ].join('\n')
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = { noCreate: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = (): string => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`seed: ${a} requires a value\n\n${usage()}`)
      return v
    }
    switch (a) {
      case '--graph':
        out.graph = next()
        break
      case '--file':
        out.file = next()
        break
      case '--title':
        out.title = next()
        break
      case '--profile-dir':
        out.profileDir = next()
        break
      case '--endpoint':
        out.endpoint = next()
        break
      case '--auth-mode':
        out.authMode = next()
        break
      case '--token':
        out.token = next()
        break
      case '--no-create':
        out.noCreate = true
        break
      default:
        throw new Error(`seed: unrecognized argument '${a}'\n\n${usage()}`)
    }
  }
  return out
}

async function resolveTarget(args: Args): Promise<SeedTarget> {
  if (args.endpoint !== undefined && args.profileDir !== undefined) {
    // HIGH-3: a WRITE CLI must refuse ambiguity, never silently pick one —
    // the prior behavior chose the gateway target and silently discarded
    // --profile-dir, which could seed the WRONG cell without any signal.
    throw new Error(
      "seed: both --endpoint and --profile-dir were given — exactly ONE write " +
        `target must resolve (got --endpoint '${args.endpoint}' AND --profile-dir ` +
        `'${args.profileDir}'). Drop one.\n\n${usage()}`,
    )
  }
  if (args.endpoint !== undefined) {
    if (args.authMode !== 'dev') {
      throw new Error(
        `seed: --endpoint requires --auth-mode dev (got '${args.authMode ?? '(none)'}') — ` +
          "seeding is an Editor write; only the 'dev' bearer-token mode is wired for it today.",
      )
    }
    if (!args.token) {
      throw new Error('seed: --endpoint requires --token (an Editor-capable bearer credential)')
    }
    if (!args.graph) throw new Error(`seed: --graph is required\n\n${usage()}`)
    return gatewaySeedTarget(args.endpoint, args.graph, args.token)
  }
  const profileDir = args.profileDir ?? process.env.GARDEN_PROFILE_DIR
  if (!profileDir) {
    throw new Error(
      `seed: no target resolvable — pass --endpoint (gateway) or --profile-dir ` +
        `(local gardend manifest discovery; $GARDEN_PROFILE_DIR also works).\n\n${usage()}`,
    )
  }
  // Throws (naming the path) if loopback.json is missing/malformed — an
  // honest refusal, never a guessed target.
  const manifest = readLoopbackManifest(profileDir)
  return loopbackSeedTarget({ mcpUrl: manifest.mcpUrl, token: manifest.token })
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.graph) throw new Error(`seed: --graph is required\n\n${usage()}`)

  const filePath = args.file ?? require.resolve('@shrubbery/nucleus/seed/garden-default.ux.nt')
  const target = await resolveTarget(args)

  if (args.noCreate) {
    const { targetGraphIri, tripleCount } = await seedGraphFromNtFile(target, {
      graphId: args.graph,
      filePath,
    })
    console.log(
      `seed: loaded ${filePath} (${tripleCount} triples) into existing graph '${args.graph}' <${targetGraphIri}>`,
    )
    return
  }

  const body = await readFile(filePath, 'utf8')
  const targetGraphIri = await createGraphAndSeedUxConfig(
    target,
    args.graph,
    body,
    args.title ?? 'Shrubbery Planter Cell',
  )
  console.log(`seed: created graph '${args.graph}' and loaded ${filePath} into <${targetGraphIri}>`)
}

main().catch((err) => {
  console.error(`seed: FAILED — ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
