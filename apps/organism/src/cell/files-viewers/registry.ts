/**
 * Which viewer a file opens in: a table of kinds, each recognized by file name, extension or MIME type, each declaring
 * its viewer. Files stays generic; a kind brings its viewer (the same shape as the card kinds of `files-kinds/`: a kind is
 * recognized, then declares what it shows).
 *
 * Opening a file never downloads it (Vera, 2026-10-08). A kind with no viewer opens the file's page, with Download.
 *
 * Recognition order: an exact file name (Dockerfile, Makefile, .env), then the extension, then the MIME type. The
 * extension wins over a MIME type because browsers guess types from extensions badly (a `.ts` file arrives as
 * `video/mp2t`); a text kind then sniffs the bytes, and a binary misnamed `.txt` goes to the file page anyway.
 */
import type { FilesTypeFacts } from '../files-policy.js'

export type FileViewerId =
  | 'pdf' | 'image' | 'svg' | 'audio' | 'video'
  | 'text' | 'markdown' | 'code' | 'json' | 'csv' | 'html' | 'docx' | 'sheet'
  | 'file'

export interface FileViewerKind {
  readonly id: string
  /** Said in the reader row and on the file page: 'Markdown', 'TypeScript', 'ZIP archive'. */
  readonly label: string
  readonly viewer: FileViewerId
  readonly extensions?: readonly string[]
  /** Exact file names, lower-case ('dockerfile', '.env'). */
  readonly filenames?: readonly string[]
  /** MIME types, exact or as a `type/*` family. */
  readonly mimeTypes?: readonly string[]
  /** The highlighter's language for code ('typescript'). */
  readonly language?: string
  /** CSV's delimiter. */
  readonly delimiter?: ',' | '\t'
  /** JSON Lines: one record per line. */
  readonly lines?: boolean
}

const code = (id: string, label: string, language: string, extensions: readonly string[], more: Partial<FileViewerKind> = {}): FileViewerKind =>
  ({ id, label, viewer: 'code', language, extensions, ...more })

export const FILE_VIEWER_KINDS: readonly FileViewerKind[] = Object.freeze([
  { id: 'pdf', label: 'PDF', viewer: 'pdf', extensions: ['pdf'], mimeTypes: ['application/pdf'] },
  { id: 'svg', label: 'SVG image', viewer: 'svg', extensions: ['svg'], mimeTypes: ['image/svg+xml'] },
  { id: 'image', label: 'Image', viewer: 'image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'], mimeTypes: ['image/*'] },
  { id: 'audio', label: 'Audio', viewer: 'audio', extensions: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'], mimeTypes: ['audio/*'] },
  { id: 'video', label: 'Video', viewer: 'video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv'], mimeTypes: ['video/*'] },
  { id: 'markdown', label: 'Markdown', viewer: 'markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'], mimeTypes: ['text/markdown', 'text/x-markdown'] },
  { id: 'csv', label: 'CSV', viewer: 'csv', delimiter: ',', extensions: ['csv'], mimeTypes: ['text/csv'] },
  { id: 'tsv', label: 'TSV', viewer: 'csv', delimiter: '\t', extensions: ['tsv', 'tab'], mimeTypes: ['text/tab-separated-values'] },
  { id: 'json', label: 'JSON', viewer: 'json', extensions: ['json', 'geojson', 'webmanifest'], mimeTypes: ['application/json', 'application/geo+json'] },
  { id: 'jsonl', label: 'JSON Lines', viewer: 'json', lines: true, extensions: ['jsonl', 'ndjson'], mimeTypes: ['application/x-ndjson', 'application/jsonl'] },
  { id: 'html', label: 'HTML', viewer: 'html', extensions: ['html', 'htm', 'xhtml'], mimeTypes: ['text/html', 'application/xhtml+xml'] },
  { id: 'docx', label: 'Word document', viewer: 'docx', extensions: ['docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  { id: 'sheet', label: 'Spreadsheet', viewer: 'sheet', extensions: ['xlsx', 'xlsm', 'xls', 'ods'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/vnd.oasis.opendocument.spreadsheet'] },
  code('typescript', 'TypeScript', 'typescript', ['ts', 'tsx', 'mts', 'cts']),
  code('javascript', 'JavaScript', 'javascript', ['js', 'jsx', 'mjs', 'cjs'], { mimeTypes: ['text/javascript', 'application/javascript'] }),
  code('python', 'Python', 'python', ['py', 'pyi', 'pyw'], { mimeTypes: ['text/x-python'] }),
  code('rust', 'Rust', 'rust', ['rs']),
  code('go', 'Go', 'go', ['go']),
  code('c', 'C', 'c', ['c', 'h']),
  code('cpp', 'C++', 'cpp', ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx']),
  code('java', 'Java', 'java', ['java']),
  code('kotlin', 'Kotlin', 'kotlin', ['kt', 'kts']),
  code('swift', 'Swift', 'swift', ['swift']),
  code('ruby', 'Ruby', 'ruby', ['rb', 'rake', 'gemspec'], { filenames: ['gemfile', 'rakefile'] }),
  code('shell', 'Shell script', 'bash', ['sh', 'bash', 'zsh', 'fish'], { mimeTypes: ['application/x-sh'] }),
  code('sql', 'SQL', 'sql', ['sql']),
  code('css', 'CSS', 'css', ['css'], { mimeTypes: ['text/css'] }),
  code('scss', 'SCSS', 'scss', ['scss', 'sass']),
  code('less', 'Less', 'less', ['less']),
  code('yaml', 'YAML', 'yaml', ['yaml', 'yml'], { mimeTypes: ['application/yaml', 'text/yaml', 'application/x-yaml'] }),
  code('toml', 'TOML', 'ini', ['toml'], { filenames: ['cargo.lock', 'poetry.lock'] }),
  code('xml', 'XML', 'xml', ['xml', 'xsd', 'xsl', 'xslt', 'plist', 'rdf', 'owl'], { mimeTypes: ['application/xml', 'text/xml'] }),
  code('dockerfile', 'Dockerfile', 'dockerfile', ['dockerfile'], { filenames: ['dockerfile', 'containerfile'] }),
  code('makefile', 'Makefile', 'makefile', ['mk', 'mak'], { filenames: ['makefile', 'gnumakefile'] }),
  code('turtle', 'RDF (Turtle)', 'plaintext', ['ttl', 'nt', 'nq', 'trig', 'n3']),
  code('csharp', 'C#', 'csharp', ['cs']),
  code('php', 'PHP', 'php', ['php']),
  code('lua', 'Lua', 'lua', ['lua']),
  code('r', 'R', 'r', ['r']),
  code('perl', 'Perl', 'perl', ['pl', 'pm']),
  code('diff', 'Diff', 'diff', ['diff', 'patch']),
  code('graphql', 'GraphQL', 'graphql', ['graphql', 'gql']),
  code('ini', 'Settings', 'ini', ['ini', 'conf', 'cfg', 'cnf', 'properties', 'editorconfig'], { filenames: ['.editorconfig', '.npmrc', '.gitconfig'] }),
  { id: 'text', label: 'Plain text', viewer: 'text', extensions: ['txt', 'text', 'log', 'env', 'out', 'err', 'nfo', 'srt', 'vtt'],
    filenames: ['.env', '.env.local', '.env.example', '.gitignore', '.dockerignore', '.gitattributes', 'readme', 'license', 'licence', 'changelog',
      'authors', 'contributing', 'copying', 'notice', 'todo'],
    mimeTypes: ['text/*'] },
  { id: 'zip', label: 'ZIP archive', viewer: 'file', extensions: ['zip'], mimeTypes: ['application/zip', 'application/x-zip-compressed'] },
  { id: 'pptx', label: 'PowerPoint presentation', viewer: 'file', extensions: ['pptx', 'ppt', 'key', 'odp'] },
  { id: 'archive', label: 'Archive', viewer: 'file', extensions: ['tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst'] },
  { id: 'epub', label: 'EPUB book', viewer: 'file', extensions: ['epub'] },
  { id: 'binary', label: 'Program', viewer: 'file', extensions: ['exe', 'dll', 'so', 'dylib', 'bin', 'wasm', 'dmg', 'pkg', 'msi', 'deb', 'rpm', 'apk', 'iso'] },
])

/** A file nothing recognizes. */
export const UNKNOWN_KIND: FileViewerKind = Object.freeze({ id: 'unknown', label: 'File', viewer: 'file' })

const byFilename = new Map<string, FileViewerKind>()
const byExtension = new Map<string, FileViewerKind>()
const byMime = new Map<string, FileViewerKind>()
for (const kind of FILE_VIEWER_KINDS) {
  for (const name of kind.filenames ?? []) if (!byFilename.has(name)) byFilename.set(name, kind)
  for (const ext of kind.extensions ?? []) if (!byExtension.has(ext)) byExtension.set(ext, kind)
  for (const mime of kind.mimeTypes ?? []) if (!byMime.has(mime)) byMime.set(mime, kind)
}

function baseName(facts: FilesTypeFacts): string {
  const name = facts.originalFilename?.trim() ?? ''
  return name.slice(name.lastIndexOf('/') + 1).toLowerCase()
}

/** The extension the file says it has: its name's, else the cell's declared `fileType`. */
export function extensionOf(facts: FilesTypeFacts): string {
  const name = baseName(facts)
  const dot = name.lastIndexOf('.')
  if (dot > 0 && dot < name.length - 1) return name.slice(dot + 1)
  const declared = facts.fileType?.trim().toLowerCase()
  return declared && declared !== 'unknown' && declared !== 'download' && /^[a-z0-9]+$/.test(declared) ? declared : ''
}

/** The kind of a file, by name, extension, then MIME type. */
export function viewerKindOf(facts: FilesTypeFacts): FileViewerKind {
  const name = baseName(facts)
  const exact = byFilename.get(name) ?? (name.startsWith('.env') ? byFilename.get('.env') : undefined)
  if (exact) return exact
  const extension = extensionOf(facts)
  const known = extension ? byExtension.get(extension) : undefined
  if (known) return known
  const mime = facts.mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (mime && mime !== 'application/octet-stream') {
    const hit = byMime.get(mime) ?? byMime.get(`${mime.split('/')[0]}/*`)
    if (hit) return hit
    if (mime.endsWith('+json')) return byExtension.get('json')!
    if (mime.endsWith('+xml')) return byExtension.get('xml')!
  }
  return UNKNOWN_KIND
}

/** Viewers that read the file as text (and so sniff it first). */
export function readsText(viewer: FileViewerId): boolean {
  return viewer === 'text' || viewer === 'markdown' || viewer === 'code' || viewer === 'json' || viewer === 'csv' || viewer === 'html'
}
