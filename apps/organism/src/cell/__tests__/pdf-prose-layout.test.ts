// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parsePdfFastTextDocument, type TipTapJsonNode } from '../pdf-layout-parser.js'

type Run = { x: number; y: number; text: string; italic?: boolean }

// A normal letter-sized text-layer PDF with actual mixed-font runs. The
// original 2000-point hash-bound column/table fixtures remain unchanged.
function letterPdf(runs: Run[]): Uint8Array {
  const escape = (text: string) => text.replace(/([\\()])/g, '\\$1')
  const stream = runs.map(run => `BT /${run.italic ? 'F2' : 'F1'} 10 Tf 1 0 0 1 ${run.x} ${run.y} Tm (${escape(run.text)}) Tj ET\n`).join('')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Oblique >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

const textOf = (node: TipTapJsonNode): string => node.text ?? (node.content ?? []).map(textOf).join(' ')
const parse = async (runs: Run[]) => (await parsePdfFastTextDocument({ bytes: letterPdf(runs), fallbackTitle: 'Ordinary digital prose' })).tiptapJson.content!.slice(1)

describe('digital prose is not a sidebar merely because its font changes near the right edge', () => {
  it('keeps a same-line italic continuation and its wrapped line in one paragraph', async () => {
    const left = 'Inline formatting stays inside the same ordinary prose line.'
    const nodes = await parse([
      { x: 72, y: 680, text: left },
      { x: 72 + left.length * 6 + 6, y: 680, text: 'The', italic: true },
      { x: 72, y: 666, text: 'next line continues that sentence without a sidebar.' },
    ])
    expect(nodes.map(node => node.type)).toEqual(['paragraph'])
    expect(textOf(nodes[0]!)).toBe(`${left} The next line continues that sentence without a sidebar.`)
  })

  it('keeps real first-line paragraph indents without breaking the following wrapped line', async () => {
    const nodes = await parse([
      { x: 72, y: 680, text: 'This is the end of the first paragraph.' },
      { x: 87, y: 666, text: 'A genuinely new paragraph starts with an indent' },
      { x: 72, y: 652, text: 'and its wrapped second line returns to the margin.' },
    ])
    expect(nodes.map(node => node.type)).toEqual(['paragraph', 'paragraph'])
    expect(textOf(nodes[0]!)).toBe('This is the end of the first paragraph.')
    expect(textOf(nodes[1]!)).toBe('A genuinely new paragraph starts with an indent and its wrapped second line returns to the margin.')
  })

  it('still orders genuine letter-page columns through their whitespace gutter', async () => {
    const runs = Array.from({ length: 7 }, (_, index) => [
      { x: 50, y: 680 - index * 14, text: `Left sentence ${index + 1} stays first` },
      { x: 335, y: 680 - index * 14, text: `Right sentence ${index + 1} comes last` },
    ]).flat()
    const nodes = await parse(runs)
    expect(nodes).toHaveLength(2)
    expect(textOf(nodes[0]!)).toContain('Left sentence 7 stays first')
    expect(textOf(nodes[0]!)).not.toContain('Right sentence')
    expect(textOf(nodes[1]!)).toContain('Right sentence 1 comes last')
    expect(textOf(nodes[1]!)).not.toContain('Left sentence')
  })
})
