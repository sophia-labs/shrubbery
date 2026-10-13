import { afterEach, expect, it } from 'vitest'
import '../wf-studio-shell.js'
import type { DevelopmentWorkspaceViewState, DevelopmentWorkspaceIntent } from '@shrubbery/nucleus'

afterEach(() => document.body.replaceChildren())
const rift = {id:'rift-a',name:'Experiment A',project:'Fixture',baseRevision:'git-123',checkpointId:'checkpoint-old'}
const state: DevelopmentWorkspaceViewState = {
  status:'ready',pending:null,error:'',rifts:[rift,{...rift,id:'rift-b',name:'Experiment B'}],selectedRiftId:rift.id,selectedFileId:'notebook',selectedEnvironmentId:'local',document:null,
  workspace:{rift,observedAt:'2026-09-19T01:00:00Z',participants:[{id:'agent',name:'Correspondent',kind:'assignment',status:'Assigned',observedAt:'2026-09-19T01:00:00Z'}],
    files:[{id:'source',documentId:'source-doc',blockId:'source-block',path:'message.txt',kind:'source'},{id:'notebook',documentId:'notebook-doc',path:'experiment.ipynb',kind:'notebook',cells:[{id:'cell-a',blockId:'block-a',language:'python',kind:'code'}]}],
    environments:[{id:'local',cluster:'Local fixture',component:'gardend',rolloutStatus:'Observed',observer:'health-check',observedAt:'2026-09-19T01:00:00Z',servingArtifact:'binary-456',sourceRevision:'Unknown'}],
    runs:[{id:'run-1',riftId:rift.id,notebookDocumentId:'notebook-doc',cellId:'cell-a',status:'completed',startedAt:'2026-09-19T01:00:00Z',checkpointId:'checkpoint-old',sourceVersion:'sha256:code',kernelId:'kernel-1',kernelGeneration:1,output:'hello from actual file',consumedFiles:[{path:'message.txt',version:'sha256:input'}],stale:true}],
  },
}

it('reaches the controlled development workspace through the existing Choreograph shell',async () => {
  const studio = document.createElement('wf-studio-shell')
  studio.developmentWorkspace = state
  document.body.append(studio); await studio.updateComplete
  const development = Array.from(studio.shadowRoot!.querySelectorAll('button')).find(button => button.textContent?.includes('Development'))!
  development.click(); await studio.updateComplete
  const pane = studio.shadowRoot!.querySelector('wf-development-workspace')!
  await pane.updateComplete
  expect(pane.state).toBe(state)
  expect(pane.shadowRoot!.textContent,pane.shadowRoot!.innerHTML).toContain('hello from actual file')
  expect(pane.shadowRoot!.textContent).toContain('Inputs changed')
  expect(pane.shadowRoot!.textContent).toContain('sha256:input')
  expect(pane.shadowRoot!.textContent).toContain('Prepared source')
  expect(pane.shadowRoot!.textContent).toContain('assignment')
  expect(pane.shadowRoot!.querySelector('time')!.getAttribute('datetime')).toBe('2026-09-19T01:00:00Z')
  const intents: DevelopmentWorkspaceIntent[] = []
  studio.addEventListener('development-workspace-intent',event => intents.push((event as CustomEvent<DevelopmentWorkspaceIntent>).detail))
  ;(pane.shadowRoot!.querySelector('[data-file-id="source"]') as HTMLButtonElement).click()
  expect(intents).toEqual([{action:'select-file',id:'source'}])
  expect(pane.state!.selectedFileId).toBe('notebook')
  const selector = pane.shadowRoot!.querySelector('[aria-label="Working Rift"]') as HTMLSelectElement
  selector.value='rift-b'; selector.dispatchEvent(new Event('change'))
  expect(intents[1]).toEqual({action:'select-rift',id:'rift-b'})
  expect(pane.shadowRoot!.querySelector('[aria-label="Observed environment"]')).not.toBe(selector)
})

it('shows the newest recorded result first without changing the retained history',async () => {
  const existing = state.workspace!.runs[0]!
  const history = Object.freeze([
    existing,
    {...existing,id:'run-newest',startedAt:'2026-09-19T03:00:00Z'},
    {...existing,id:'run-middle',startedAt:'2026-09-19T02:00:00Z'},
  ])
  const pane = document.createElement('wf-development-workspace')
  pane.state = {...state,workspace:{...state.workspace!,runs:history}}
  document.body.append(pane); await pane.updateComplete
  expect(Array.from(pane.shadowRoot!.querySelectorAll('[data-run-id]')).map(run => run.getAttribute('data-run-id'))).toEqual(['run-newest','run-middle','run-1'])
  expect(history.map(run => run.id)).toEqual(['run-1','run-newest','run-middle'])
})
