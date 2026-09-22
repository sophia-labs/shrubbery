import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KOREADER_WORKSPACE_CATALOGUE_SCHEMA,
  KOREADER_WORKSPACE_CATALOGUE_VERSION,
  type KoreaderArtifactFile,
  type KoreaderWorkspaceCatalogue,
  type ReaderLibrary,
  renderKoreaderFeed,
  safeDocumentFileStem,
} from '@shrubbery/koreader'
import { readLoopbackManifest } from '@shrubbery/source/node'
import { fixtureLibrary } from './fixture.js'
import {
  type GardenDocumentSource,
  loadGardenLibrary,
  loadGardenWorkspaceCatalogue,
} from './garden-client.js'

interface BuildArgs {
  readonly input?: string
  readonly output: string
  readonly gardenBase?: string
  readonly gardenManifest?: string
  readonly gardenDocumentSource?: GardenDocumentSource
  readonly graph?: string
  readonly gardenMinimumCharacters?: number
  readonly gardenAllWorkspaces?: boolean
  readonly tokenFile?: string
  readonly title?: string
}

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(appRoot, '../..')
const defaultOutputRoot = resolve(appRoot, 'dist')
const args = parseArgs(process.argv.slice(2))
const outputRoot = isAbsolute(args.output) ? args.output : resolve(process.cwd(), args.output)
assertSafeOutputRoot(outputRoot)
const libraries = await resolveLibraries(args)
const library = libraries[0]
const generatedAt = new Date().toISOString()
const artifact = renderKoreaderFeed(library, { generatedAt, workspaceCataloguePath: 'workspaces.json' })
const workspacePaths = new Map<string, string>([[library.id, 'manifest.json']])
const workspaceFiles: KoreaderArtifactFile[] = []
for (const workspace of libraries.slice(1)) {
  const prefix = `workspaces/${safeDocumentFileStem(workspace.graphId)}`
  workspacePaths.set(workspace.id, `${prefix}/manifest.json`)
  const workspaceArtifact = renderKoreaderFeed(workspace, {
    generatedAt,
    workspaceCataloguePath: '../../workspaces.json',
  })
  for (const file of workspaceArtifact.files) {
    workspaceFiles.push({ ...file, path: `${prefix}/${file.path}` })
  }
}
const catalogue: KoreaderWorkspaceCatalogue = {
  schema: KOREADER_WORKSPACE_CATALOGUE_SCHEMA,
  version: KOREADER_WORKSPACE_CATALOGUE_VERSION,
  generatedAt,
  activeWorkspaceId: library.id,
  workspaces: libraries.map((workspace) => ({
    id: workspace.id,
    graphId: workspace.graphId,
    title: workspace.title,
    manifestPath: workspacePaths.get(workspace.id) ?? 'manifest.json',
    documentCount: workspace.documents.length,
    folderCount: workspace.folders?.length ?? 0,
  })),
}
const feedRoot = join(outputRoot, 'feed')
const runtimeRoot = join(appRoot, 'runtime', 'sophia.koplugin')
const pluginRoot = join(outputRoot, 'sophia.koplugin')

await rm(outputRoot, { recursive: true, force: true })
await mkdir(feedRoot, { recursive: true })
for (const file of artifact.files) await writeArtifactFile(feedRoot, file)
await writeArtifactFile(feedRoot, {
  path: 'workspaces.json',
  mediaType: 'application/json; charset=utf-8',
  body: `${JSON.stringify(catalogue, null, 2)}\n`,
})
for (const file of workspaceFiles) await writeArtifactFile(feedRoot, file)
await cp(runtimeRoot, pluginRoot, { recursive: true })
await writeFile(
  join(outputRoot, 'INSTALL.txt'),
  [
    'Sophia Reader for KOReader',
    '',
    '1. Copy sophia.koplugin into KOReader/plugins/.',
    '2. Serve the feed/ directory over HTTP or HTTPS.',
    '3. Restart KOReader. Sophia opens as the reader home surface.',
    '4. Open Sophia → Settings and enter the manifest URL.',
    '5. Choose Sync Garden; cached XHTML documents open in KOReader itself.',
    '',
    `Library: ${artifact.manifest.library.title}`,
    `Documents: ${artifact.manifest.documents.length}`,
    `Workspaces: ${catalogue.workspaces.length}`,
    '',
  ].join('\n'),
  'utf8',
)

console.log(`Built KOReader artifact at ${outputRoot}`)
console.log(`  plugin: ${pluginRoot}`)
console.log(`  feed:   ${feedRoot}`)
console.log(`  docs:   ${artifact.manifest.documents.length}`)
console.log(`  spaces: ${catalogue.workspaces.length}`)

async function resolveLibraries(buildArgs: BuildArgs): Promise<readonly ReaderLibrary[]> {
  if (buildArgs.input) return [await readLibrary(buildArgs.input)]
  if (
    buildArgs.gardenBase
    || buildArgs.gardenManifest
    || buildArgs.gardenDocumentSource
    || buildArgs.gardenMinimumCharacters !== undefined
    || buildArgs.graph
  ) {
    if (!buildArgs.graph) throw new Error('Garden builds require --graph')
    const manifest = buildArgs.gardenManifest
      ? readLoopbackManifest(resolveInputPath(buildArgs.gardenManifest))
      : undefined
    const baseUrl = manifest?.apiUrl ?? buildArgs.gardenBase
    if (!baseUrl) {
      throw new Error('Garden builds require either --garden-base or --garden-manifest')
    }
    const token = manifest?.token
      ?? (buildArgs.tokenFile ? await readTokenFile(buildArgs.tokenFile) : undefined)
    const requested = buildArgs.gardenAllWorkspaces
      ? await loadGardenWorkspaceCatalogue({ baseUrl, ...(token ? { token } : {}) })
      : [{ graphId: buildArgs.graph, title: buildArgs.title ?? buildArgs.graph, status: 'active' }]
    const current = requested.find((workspace) => workspace.graphId === buildArgs.graph)
      ?? { graphId: buildArgs.graph, title: buildArgs.title ?? buildArgs.graph, status: 'active' }
    const ordered = [
      current,
      ...requested
        .filter((workspace) => workspace.graphId !== buildArgs.graph && workspace.status === 'active')
        .sort((left, right) => left.title.localeCompare(right.title)),
    ]
    const loaded = await Promise.all(ordered.map((workspace) => loadGardenLibrary({
      baseUrl,
      graphId: workspace.graphId,
      ...(token ? { token } : {}),
      title: workspace.graphId === buildArgs.graph && buildArgs.title
        ? buildArgs.title
        : workspace.title,
      ...(buildArgs.gardenDocumentSource
        ? { documentSource: buildArgs.gardenDocumentSource }
        : {}),
      ...(buildArgs.gardenMinimumCharacters === undefined
        ? {}
        : { minimumContentCharacters: buildArgs.gardenMinimumCharacters }),
    })))
    return loaded.filter((workspace, index) => index === 0 || workspace.documents.length > 0)
  }
  return [fixtureLibrary]
}

function parseArgs(argv: readonly string[]): BuildArgs {
  let input: string | undefined
  let gardenBase: string | undefined
  let gardenManifest: string | undefined
  let gardenDocumentSource: GardenDocumentSource | undefined
  let graph: string | undefined
  let gardenMinimumCharacters: number | undefined
  let gardenAllWorkspaces = false
  let tokenFile: string | undefined
  let title: string | undefined
  let output = resolve(appRoot, 'dist')
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--input') input = requiredNext(argv, ++index, '--input')
    else if (value === '--out') output = requiredNext(argv, ++index, '--out')
    else if (value === '--garden-base') gardenBase = requiredNext(argv, ++index, '--garden-base')
    else if (value === '--garden-manifest') gardenManifest = requiredNext(argv, ++index, '--garden-manifest')
    else if (value === '--garden-document-source') {
      gardenDocumentSource = parseGardenDocumentSource(
        requiredNext(argv, ++index, '--garden-document-source'),
      )
    }
    else if (value === '--graph') graph = requiredNext(argv, ++index, '--graph')
    else if (value === '--garden-minimum-characters') {
      gardenMinimumCharacters = parseNonNegativeInteger(
        requiredNext(argv, ++index, '--garden-minimum-characters'),
        '--garden-minimum-characters',
      )
    }
    else if (value === '--garden-all-workspaces') gardenAllWorkspaces = true
    else if (value === '--token-file') tokenFile = requiredNext(argv, ++index, '--token-file')
    else if (value === '--title') title = requiredNext(argv, ++index, '--title')
    else if (value === '--help' || value === '-h') {
      console.log([
        'tsx src/build.ts [--out dist]',
        '  [--input reader-library.json]',
        '  [--garden-manifest loopback.json --graph GRAPH_ID [--title TITLE]]',
        '  [--garden-base CELL_ROOT --graph GRAPH_ID [--token-file PATH] [--title TITLE]]',
        '  [--garden-document-source hosted-blocks|tiptap-xml]',
        '  [--garden-minimum-characters COUNT]',
        '  [--garden-all-workspaces]',
        '',
        'With no input mode, builds the committed two-document fixture.',
      ].join('\n'))
      process.exit(0)
    } else throw new Error(`Unknown argument: ${value}`)
  }
  if (gardenBase && gardenManifest) {
    throw new Error('--garden-base and --garden-manifest are mutually exclusive')
  }
  if (
    input
    && (
      gardenBase
      || gardenManifest
      || gardenDocumentSource
      || gardenMinimumCharacters !== undefined
      || gardenAllWorkspaces
      || graph
      || tokenFile
    )
  ) {
    throw new Error('--input and Garden source options are mutually exclusive')
  }
  if (tokenFile && !gardenBase) {
    throw new Error('--token-file requires --garden-base')
  }
  return {
    ...(input ? { input } : {}),
    ...(gardenBase ? { gardenBase } : {}),
    ...(gardenManifest ? { gardenManifest } : {}),
    ...(gardenDocumentSource ? { gardenDocumentSource } : {}),
    ...(graph ? { graph } : {}),
    ...(gardenMinimumCharacters === undefined ? {} : { gardenMinimumCharacters }),
    ...(gardenAllWorkspaces ? { gardenAllWorkspaces } : {}),
    ...(tokenFile ? { tokenFile } : {}),
    ...(title ? { title } : {}),
    output,
  }
}

function parseGardenDocumentSource(value: string): GardenDocumentSource {
  if (value === 'hosted-blocks' || value === 'tiptap-xml') return value
  throw new Error('--garden-document-source must be hosted-blocks or tiptap-xml')
}

function parseNonNegativeInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new Error(`${flag} must be an integer from 0 through 1000000`)
  }
  return parsed
}

function requiredNext(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

async function readLibrary(inputPath: string): Promise<ReaderLibrary> {
  const absolute = resolveInputPath(inputPath)
  return JSON.parse(await readFile(absolute, 'utf8')) as ReaderLibrary
}

async function readTokenFile(tokenPath: string): Promise<string> {
  const token = (await readFile(resolveInputPath(tokenPath), 'utf8')).trim()
  if (!token) throw new Error(`Garden token file is empty: ${tokenPath}`)
  return token
}

function resolveInputPath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value)
}

function assertSafeOutputRoot(value: string): void {
  if (value === parse(value).root) {
    throw new Error(`Refusing to replace filesystem root: ${value}`)
  }
  if (isWithin(value, repositoryRoot) || isWithin(value, appRoot)) {
    throw new Error(`Refusing to replace a source-tree ancestor: ${value}`)
  }
  if (isWithin(repositoryRoot, value) && !isWithin(defaultOutputRoot, value)) {
    throw new Error(`Repository-local output must stay under ${defaultOutputRoot}`)
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate)
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
}

async function writeArtifactFile(root: string, file: KoreaderArtifactFile): Promise<void> {
  const destination = resolve(root, file.path)
  const relation = relative(root, destination)
  if (relation.startsWith(`..${sep}`) || relation === '..' || isAbsolute(relation)) {
    throw new Error(`Artifact path escapes feed root: ${file.path}`)
  }
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, file.body, 'utf8')
}
