/**
 * Hoja's MUS mode: the grammar's scopes on a real score, the one-fence projection, and `<hoja-mus-editor>` (a REAL Hoja
 * page with the MUS highlighter and the checker's verdict drawn into the fence).
 */
import type { Editor } from '@shrubbery/editor-kernel'
import { describe, expect, it } from 'vitest'

import type { HojaEditor } from '../../hoja-editor.js'
import {
  type HojaMusEditor,
  MultipleMusSourcesError,
  NoMusSourceError,
  createMusHighlighter,
  highlightMus,
  musPageDocument,
  projectMusSource,
  type MusCheckReport,
  type MusSourceChangeDetail,
} from '../index.js'

const TOUR = `# score: Steel-string tour
# tempo: 96    time: 4/4    key: Am    bars: 9
# text @b1: the open strings, low to high
# instruments:
#   gt   = steel-string guitar (treble, -12, anatomy=steel-string-v0, tuning=E2 A2 D3 G3 B3 E4, capo=0)
#   gt.p = thumb, thumbpick (treble, pos=0.10, pick=0.85, pm=0.45)
bar 1 [chord=Em]: gt.p=E2q@6:0 A2q@5:0 D3q@4:0 Rq  gt.v=Rh. G3q@3:0
bar 3: gt.v=<G3@3:0 B3@2:0 E4@1:0>h Rh gt.p={p} (A2e@5:0 E3e@4:2 ×4) B3e@3:4[ho,gain=-6] E4h~e@1:0 C4e3@2:1 gt.r=-
`

function scopes(code: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const r of highlightMus(code)) {
    const text = code.slice(r.from, r.to)
    out.set(text, [...(out.get(text) ?? []), r.className])
  }
  return out
}

describe('the MUS grammar', () => {
  const s = scopes(TOUR)
  it('reads a bar: keyword, number, meta, then each hand and its tokens', () => {
    expect(s.get('bar')).toContain('hljs-keyword')
    expect(s.get('[chord=Em]')).toEqual(['hljs-meta'])
    expect(s.get('gt.p')).toContain('hljs-variable')
    expect(s.get('E2')).toContain('hljs-title')
    expect(s.get('q')).toContain('hljs-type')
    expect(s.get('@6:0')).toEqual(['hljs-number'])
    expect(s.get('h~e')).toEqual(['hljs-type'])
    expect(s.get('e3')).toEqual(['hljs-type'])
    expect(s.get('h.')).toEqual(['hljs-type'])
    expect(s.get('{p}')).toEqual(['hljs-built_in'])
    expect(s.get('R')).toContain('hljs-literal')
    expect(s.get('<')).toEqual(['hljs-punctuation'])
    expect(s.get('×4)')).toEqual(['hljs-operator'])
    expect(s.get('ho')).toEqual(['hljs-params hljs-attr'])
    expect(s.get('-6')).toEqual(['hljs-params hljs-number'])
    expect(s.get('-')).toEqual(['hljs-literal'])
  })
  it('reads headers, text comments and instrument lines', () => {
    expect(s.get('tempo')).toEqual(['hljs-meta'])
    expect(s.get('96')).toEqual(['hljs-string'])
    expect(s.get('# text @b1:')).toEqual(['hljs-meta'])
    expect(s.get(' the open strings, low to high')).toEqual(['hljs-comment'])
    expect(s.get('gt')).toEqual(['hljs-variable'])
    expect(s.get('anatomy')).toEqual(['hljs-attr'])
    expect(s.get('steel-string-v0')).toEqual(['hljs-string'])
    expect(s.get('0.85')).toEqual(['hljs-number'])
  })
  it('colours mus fences and leaves other languages to the host', () => {
    const highlight = createMusHighlighter((_code, language) => (language === 'js' ? [{ from: 0, to: 1, className: 'hljs-keyword' }] : null))
    expect(highlight('bar 1: a=C4q', 'mus')?.length).toBeGreaterThan(0)
    expect(highlight('bar 1: a=C4q', 'mus-t')?.length).toBeGreaterThan(0)
    expect(highlight('x', 'js')).toEqual([{ from: 0, to: 1, className: 'hljs-keyword' }])
    expect(highlight('x', 'python')).toBeNull()
  })
})

describe('the ```mus projection', () => {
  it('reads exactly one fence; zero and two are loud', () => {
    expect(projectMusSource(musPageDocument(TOUR, { title: 'Tour', notes: 'One fretted line.' })).source).toBe(TOUR)
    expect(() => projectMusSource({ type: 'doc', content: [{ type: 'paragraph' }] })).toThrow(NoMusSourceError)
    const two = { type: 'doc', content: [musPageDocument('a').content![0]!, musPageDocument('b').content![0]!] }
    expect(() => projectMusSource(two)).toThrow(MultipleMusSourcesError)
    const prose = musPageDocument(TOUR, { title: 'Tour', notes: 'One.\n\nTwo.' })
    expect(prose.content!.map(n => n.type)).toEqual(['heading', 'paragraph', 'paragraph', 'codeBlock'])
  })
})

function editorOf(element: HojaMusEditor): Editor {
  const hoja = element.querySelector('hoja-editor') as HojaEditor
  const editor = (hoja as unknown as { editor: Editor | null }).editor
  if (!editor) throw new Error('Hoja did not mount')
  return editor
}

async function mount(score: string): Promise<{ element: HojaMusEditor; changes: MusSourceChangeDetail[] }> {
  const element = document.createElement('hoja-mus-editor') as HojaMusEditor
  const changes: MusSourceChangeDetail[] = []
  element.addEventListener('mus-source-change', e => changes.push((e as CustomEvent<MusSourceChangeDetail>).detail))
  element.document = musPageDocument(score, { title: 'A wrong fret' })
  document.body.appendChild(element)
  await element.updateComplete
  const hoja = element.querySelector('hoja-editor') as HojaEditor
  await hoja.updateComplete
  await Promise.resolve()
  return { element, changes }
}

const WRONG = `# instruments:
#   gt   = steel-string guitar (treble, anatomy=steel-string-v0)
#   gt.v = fingers (treble)
bar 1: gt.v=C4e@2:3 Re Rh.
`
const REPORT: MusCheckReport = {
  schema: 'ovillo.mus-wasm.check.v1',
  producer: 'mus-wasm',
  engineVersion: 'mus-engine/0.2.0-wf8',
  clean: false,
  sourceDigest: 'sha256:—',
  score: { title: 'Untitled', bars: 1, durationSeconds: 6 },
  worlds: [],
  diagnostics: [{
    severity: 'error',
    code: 'tab-position-disagrees',
    message: 'C4e@2:3: string 2 (B3) at fret 3 sounds D4, not C4 (SPEC-TAB §1)',
    anchor: { kind: 'event', bar: 1, track: 'gt.v', tokenIndex: 0, token: 'C4e@2:3' },
    span: { from: WRONG.indexOf('C4e@2:3'), to: WRONG.indexOf('C4e@2:3') + 7, line: 4 },
  }],
}

describe('<hoja-mus-editor>', () => {
  it('is a Hoja page whose fence is coloured as MUS, and says its score', async () => {
    const { element, changes } = await mount(WRONG)
    expect(changes.at(-1)?.source).toBe(WRONG)
    expect(element.source).toBe(WRONG)
    expect(element.querySelector('h2')?.textContent).toBe('A wrong fret')
    expect(element.querySelector('pre .hljs-title')?.textContent).toBe('C4')
    expect(element.querySelector('pre .hljs-number')).not.toBeNull()
  })

  it('draws a verdict into the token, moves it with an edit, and takes the next verdict', async () => {
    const { element, changes } = await mount(WRONG)
    element.setVerdict(WRONG, REPORT)
    // The underline is split where the grammar's scopes split the token: together they are the token.
    const marked = [...element.querySelectorAll('.hoja-diag--error')].map(e => e.textContent).join('')
    expect(marked).toBe('C4e@2:3')
    expect(element.diagnosticRanges().length).toBe(1)
    expect(element.querySelector('.hoja-diag-note')?.textContent).toContain('sounds D4, not C4')

    // Fix the fret where a visitor would: the 3 after "C4e@2:".
    const editor = editorOf(element)
    let fence = -1
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'codeBlock') fence = pos + 1 })
    const at = fence + WRONG.indexOf('C4e@2:3') + 6
    editor.view.dispatch(editor.state.tr.insertText('1', at, at + 1))
    const fixed = WRONG.replace('C4e@2:3', 'C4e@2:1')
    expect(changes.at(-1)?.source).toBe(fixed)
    expect(element.verdictStale).toBe(true)
    expect(element.querySelector('.hoja-diag--stale')).not.toBeNull()

    element.setVerdict(fixed, { ...REPORT, clean: true, diagnostics: [] })
    expect(element.verdictStale).toBe(false)
    expect(element.querySelector('.hoja-diag')).toBeNull()
    expect(element.querySelector('.hoja-diag-note')).toBeNull()
  })

  it('reveals a diagnostic by selecting its token', async () => {
    const { element } = await mount(WRONG)
    element.setVerdict(WRONG, REPORT)
    expect(element.reveal(REPORT.diagnostics[0]!)).toBe(true)
    const { from, to } = editorOf(element).state.selection
    expect(editorOf(element).state.doc.textBetween(from, to)).toBe('C4e@2:3')
  })

  it('says so when the page loses its fence', async () => {
    const { element, changes } = await mount(WRONG)
    const editor = editorOf(element)
    editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'no score' }] }] })
    editor.view.dispatch(editor.state.tr.insertText('!', 1))
    expect(changes.at(-1)?.source).toBeNull()
    expect(changes.at(-1)?.error).toMatch(/No ```mus fence/)
  })
})
