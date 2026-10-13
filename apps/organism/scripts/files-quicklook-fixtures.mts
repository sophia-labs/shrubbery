/**
 * One small file of each kind the Files reader shows, made here (no binary fixtures in the repo): Markdown with a table,
 * TypeScript, JSON, a quoted CSV, a 200,000-row CSV, HTML with a script that must not run, an SVG, a short WAV, a tiny
 * DOCX, a two-sheet XLSX, a ZIP, and a binary misnamed .txt. Used by scripts/files-quicklook-browser.mts and by the local
 * view (scripts/files-quicklook-local.mts).
 */
import { strToU8, zipSync } from 'fflate'
import { utils, write } from 'xlsx'

export interface Fixture { readonly name: string; readonly type: string; readonly bytes: Uint8Array }

const text = (s: string) => new TextEncoder().encode(s)

/** `remote` is a URL prefix nobody may fetch while a file is merely read (the browser script watches it). */
export function quicklookFixtures(remote: string, options: { readonly bigRows?: number } = {}): Fixture[] {
  const md = `# Reading list

Borges and friends: a **table**, a list, some \`code\` and a [link](https://www.gutenberg.org).

| Author | Book | Year |
|---|---|---:|
| Jorge Luis Borges | Ficciones | 1944 |
| Julio Cortázar | Rayuela | 1963 |
| Silvina Ocampo | La furia | 1959 |

- *Labyrinths*, the English selection
- **The Aleph**, 1949

> "I have always imagined that Paradise will be a kind of library."

\`\`\`ts
const shelves: number = 7
\`\`\`

![A picture on another site](${remote}/markdown-picture.png)
`
  const ts = `/** A tiny module. */
export interface Book { readonly title: string; readonly year: number }

export function oldest(books: readonly Book[]): Book | undefined {
  // The first by year; ties keep their order.
  return [...books].sort((a, b) => a.year - b.year)[0]
}

const shelf: Book[] = [{ title: 'Ficciones', year: 1944 }, { title: 'Rayuela', year: 1963 }]
console.log(oldest(shelf)?.title ?? 'none')
`
  const json = JSON.stringify({ library: 'Babel', hexagons: 6, open: true, shelves: [{ id: 1, books: 32 }, { id: 2, books: 35 }], keeper: null })
  const csv = 'name,city,note,amount\r\n"Borges, Jorge Luis",Buenos Aires,"wrote ""Ficciones""\nand more",1944\r\nCortázar,Paris,plain,1963\r\nOcampo,Buenos Aires,,1959\r\n'
  const rows = options.bigRows ?? 200_000
  const big: string[] = ['id,name,city,amount,when']
  const cities = ['Montevideo', 'Buenos Aires', 'Lisboa', 'Oakland', 'Ciudad de México', 'São Paulo']
  for (let i = 0; i < rows; i++) big.push(`${i + 1},Person ${i + 1},${cities[i % cities.length]},${((i * 7919) % 100000) / 100},2026-${String((i % 12) + 1).padStart(2, '0')}-01`)
  const html = `<!doctype html><html><head><title>A page</title><style>body { background: red }</style>
<script>window.__quicklookRan = true; fetch('${remote}/script-fetch')</script></head>
<body onload="window.__quicklookRan = true">
<h1>Field notes</h1>
<p>A paragraph with <strong>bold</strong>, <em>italic</em> and <a href="https://example.com/notes">a link</a>.
<a href="javascript:window.__quicklookRan = true">a bad link</a></p>
<img src="${remote}/html-picture.png" alt="remote picture" onerror="window.__quicklookRan = true">
<iframe src="${remote}/frame"></iframe>
<ul><li>first</li><li>second</li></ul>
<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody><tr><td>alpha</td><td>1</td></tr></tbody></table>
<script>document.body.dataset.ran = 'yes'</script>
</body></html>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
<rect x="4" y="4" width="232" height="112" rx="12" fill="#39765a"/><circle cx="60" cy="60" r="36" fill="#f4f6f4"/>
<text x="110" y="70" font-size="28" fill="#fff" font-family="sans-serif">Babel</text>
<script>window.__quicklookRan = true</script></svg>`
  return [
    { name: 'Reading list.md', type: 'text/markdown', bytes: text(md) },
    { name: 'shelf.ts', type: 'video/mp2t', bytes: text(ts) },
    { name: 'library.json', type: 'application/json', bytes: text(json) },
    { name: 'people.csv', type: 'text/csv', bytes: text(csv) },
    { name: 'big.csv', type: 'text/csv', bytes: text(big.join('\n')) },
    { name: 'Field notes.html', type: 'text/html', bytes: text(html) },
    { name: 'logo.svg', type: 'image/svg+xml', bytes: text(svg) },
    { name: 'tone.wav', type: 'audio/wav', bytes: wav(0.6) },
    { name: 'Letter to Lucy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: docx() },
    { name: 'Budget 2026.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: xlsx() },
    { name: 'notes.zip', type: 'application/zip', bytes: zipSync({ 'notes.txt': strToU8('hello') }) },
    { name: 'disguised.txt', type: 'text/plain', bytes: new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0x3e, 0]) },
    { name: 'server.log', type: 'text/plain', bytes: text(Array.from({ length: 40 }, (_, i) => `2026-10-08T17:${String(i).padStart(2, '0')}:00Z INFO request ${i} served in ${(i * 13) % 97} ms`).join('\n') + '\n') },
  ]
}

/** A mono 16-bit PCM WAV of a 440 Hz tone. */
export function wav(seconds: number, rate = 8000): Uint8Array {
  const samples = Math.round(seconds * rate)
  const out = new DataView(new ArrayBuffer(44 + samples * 2))
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)) }
  ascii(0, 'RIFF'); out.setUint32(4, 36 + samples * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true)
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); ascii(36, 'data'); out.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) out.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), true)
  return new Uint8Array(out.buffer)
}

/** The smallest honest Word document: a title, a paragraph with bold, a two-row table. */
export function docx(): Uint8Array {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${w}"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Letter to Lucy</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Dear Lucy, the garden is </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>blooming</w:t></w:r><w:r><w:t xml:space="preserve"> again.</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Plant</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Count</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Jasmine</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr/></w:body></w:document>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
  })
}

/** A workbook with two sheets, so the tabs have something to switch. */
export function xlsx(): Uint8Array {
  const book = utils.book_new()
  utils.book_append_sheet(book, utils.aoa_to_sheet([['Month', 'Rent', 'Food'], ['January', 1200, 340.5], ['February', 1200, 298.25], ['March', 1250, 410]]), 'Expenses')
  utils.book_append_sheet(book, utils.aoa_to_sheet([['Source', 'Amount'], ['Salary', 5200], ['Garden', 120]]), 'Income')
  return new Uint8Array(write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}
