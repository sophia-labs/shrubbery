// Same byte builder as the 2026-09-07 hash-bound paired extraction probes.
// These in-memory test fixtures do not model scans, graphics, or arbitrary PDFs.
export interface PdfRow { x?: number; y?: number; text: string; size?: number; matrix?: readonly [number, number, number, number, number, number] }
export interface PdfPageOptions { mediaBox?: readonly number[]; cropBox?: readonly number[]; rotation?: number; userUnit?: number }
export function pdfBytes(pageRows: readonly (readonly PdfRow[])[], pageOptions: readonly PdfPageOptions[] = []): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const byteLength = (value: string) => encoder.encode(value).byteLength;
  const esc = (s: string) => s.replace(/([\\()])/g, '\\$1');
  const streams = pageRows.map(rows => rows.map(({ x = 72, y = 1900, text, size = 12, matrix }) =>
    `BT\n/F1 ${size} Tf\n${matrix ? matrix.join(' ') : `1 0 0 1 ${x} ${y}`} Tm\n(${esc(text)}) Tj\nET\n`).join(''));
  const pageIds = streams.map((_, i) => 4 + i * 2);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${streams.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  streams.forEach((stream, i) => {
    const options = pageOptions[i] ?? {};
    const frame = `/MediaBox [${(options.mediaBox ?? [0, 0, 2000, 2000]).join(' ')}]`
      + (options.cropBox ? ` /CropBox [${options.cropBox.join(' ')}]` : '')
      + (options.rotation === undefined ? '' : ` /Rotate ${options.rotation}`)
      + (options.userUnit === undefined ? '' : ` /UserUnit ${options.userUnit}`);
    objects.push(`<< /Type /Page /Parent 2 0 R ${frame} /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`);
    objects.push(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`);
  });
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encoder.encode(body);
}

export const columnRows: PdfRow[] = Array.from({ length: 6 }, (_, i) => [
  { x: 72, y: 1900 - i * 28, text: `Left column sentence ${i + 1} stays before the turn with enough evidence` },
  { x: 1080, y: 1900 - i * 28, text: `Right column sentence ${i + 1} stays after the turn with enough evidence` },
]).flat()
export const tableCells = [['Species', 'Favorite Trick', 'Tell'], ['Index Imp', 'moves references', 'page numbers rhyme'], ['Mirror Sprite', 'reverses motives', 'names lean backward']]
export const tableRows: PdfRow[] = tableCells.flatMap((row, rowIndex) => row.map((text, columnIndex) => ({
  x: [72, 280, 500][columnIndex], y: 1900 - rowIndex * 34, size: rowIndex === 0 ? 13 : 12, text,
})))
