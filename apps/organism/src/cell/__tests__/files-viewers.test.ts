// @vitest-environment node
/**
 * The Files viewers' pure parts: which kind a file is (name, extension, MIME type), the CSV/TSV parser, and reading
 * bytes as text (sniff, decode, cap).
 */
import { describe, expect, it } from 'vitest'
import { viewerKindOf } from '../files-viewers/registry.js'
import { parseDelimited, parseDelimitedChunked, sniffDelimiter } from '../files-viewers/delimited.js'
import { capBytes, decodeText, looksBinary } from '../files-viewers/text.js'

const kind = (originalFilename: string, mimeType = '') => viewerKindOf({ originalFilename, mimeType })

describe('which viewer a file opens in', () => {
  it('by exact name, then extension (over a browser-guessed MIME type), then MIME type; else the file page', () => {
    expect([kind('Dockerfile'), kind('Makefile'), kind('.env.production'), kind('LICENSE')].map(k => [k.viewer, k.label]))
      .toEqual([['code', 'Dockerfile'], ['code', 'Makefile'], ['text', 'Plain text'], ['text', 'Plain text']])
    expect(kind('main.ts', 'video/mp2t')).toMatchObject({ viewer: 'code', language: 'typescript' })
    expect(kind('notes.md')).toMatchObject({ viewer: 'markdown' })
    expect(kind('t.tsv')).toMatchObject({ viewer: 'csv', delimiter: '\t' })
    expect(kind('d.jsonl')).toMatchObject({ viewer: 'json', lines: true })
    expect(kind('Letter.docx').viewer).toBe('docx')
    expect(kind('Budget.ODS').viewer).toBe('sheet')
    expect(kind('logo.svg', 'image/svg+xml').viewer).toBe('svg')
    expect(kind('tone.wav').viewer).toBe('audio')
    expect(kind('clip', 'video/webm').viewer).toBe('video')
    expect(kind('readme', 'text/plain').viewer).toBe('text')
    expect(kind('x.weird', 'text/x-weird').viewer).toBe('text')
    expect(kind('manifest', 'application/ld+json').viewer).toBe('json')
    expect(kind('archive.zip')).toMatchObject({ viewer: 'file', label: 'ZIP archive' })
    expect(kind('Deck.pptx')).toMatchObject({ viewer: 'file' })
    expect(kind('blob', 'application/octet-stream')).toMatchObject({ viewer: 'file', id: 'unknown' })
  })
})

describe('CSV and TSV', () => {
  it('quoted fields, doubled quotes, delimiters and line breaks inside quotes, CRLF, BOM, blank lines, ragged rows', () => {
    const t = parseDelimited('﻿a,b,c\r\n1,"two, too","3\r\nthree"\r\n\r\n"say ""hi""",x\n4,5,6,7\n')
    expect(t.columns).toEqual(['a', 'b', 'c'])
    expect(t.rows).toEqual([['1', 'two, too', '3\r\nthree'], ['say "hi"', 'x'], ['4', '5', '6', '7']])
  })

  it('an unterminated quote takes the rest; a trailing delimiter is an empty field; TSV and semicolons', () => {
    expect(parseDelimited('h\n"open, never closed\nstill').rows).toEqual([['open, never closed\nstill']])
    expect(parseDelimited('a,b\n1,').rows).toEqual([['1', '']])
    expect(parseDelimited('a\tb\n1\t"x\ty"', '\t').rows).toEqual([['1', 'x\ty']])
    expect(sniffDelimiter('a;b;c\n1;2;3', ',')).toBe(';')
    expect(sniffDelimiter('a,b\n', ',')).toBe(',')
  })

  it('in slices, the same table as all at once (200,000 rows)', async () => {
    const lines = ['id,name,note']
    for (let i = 0; i < 200_000; i++) lines.push(i % 1000 === 0 ? `${i},"Name ${i}","multi\nline ${i}"` : `${i},Name ${i},plain`)
    const text = lines.join('\n')
    const chunked = await parseDelimitedChunked(text, ',', { slice: 7_000 })
    expect(chunked.rows.length).toBe(200_000)
    expect(chunked.rows[1000]).toEqual(['1000', 'Name 1000', 'multi\nline 1000'])
    expect(chunked.rows[199_999]).toEqual(['199999', 'Name 199999', 'plain'])
    expect(chunked).toEqual(parseDelimited(text))
  })
})

describe('bytes as text', () => {
  it('sniffs binaries, decodes BOMs, strict UTF-8 with a Windows-1252 fallback, caps at a line break', () => {
    expect(looksBinary(new Uint8Array([80, 75, 3, 4, 0, 0]))).toBe(true)
    expect(looksBinary(new TextEncoder().encode('plain\ttext\r\n'))).toBe(false)
    expect(looksBinary(new Uint8Array([0xff, 0xfe, 104, 0]))).toBe(false)
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 104, 105]))).toEqual({ text: 'hi', encoding: 'utf-8' })
    expect(decodeText(new Uint8Array([0xff, 0xfe, 104, 0, 105, 0]))).toEqual({ text: 'hi', encoding: 'utf-16le' })
    expect(decodeText(new Uint8Array([99, 97, 102, 0xe9]))).toEqual({ text: 'café', encoding: 'windows-1252' })
    const bytes = new TextEncoder().encode('aaaa\nbbbb\ncccc\n')
    expect(capBytes(bytes, 12)).toEqual({ bytes: bytes.subarray(0, 10), truncated: true })
    expect(capBytes(bytes, 100).truncated).toBe(false)
    const accents = new TextEncoder().encode('ééééé')
    expect(new TextDecoder().decode(capBytes(accents, 5).bytes)).toBe('éé')
  })
})
