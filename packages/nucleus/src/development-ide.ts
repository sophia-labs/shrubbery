/** Repository workbench contracts. Offsets/lengths are UTF-16; lines/columns are zero-based. */
import type { ProviderHandle } from './contract.js'
import type { DevelopmentFile, DevelopmentParticipant } from './development-workspace.js'

export interface IdeFile {
  readonly fileId: string
  readonly path: string
  readonly bytes: number
  readonly mode: number | string
  readonly tracked: boolean
  readonly gitStatus: string
  readonly kind: 'text' | 'binary' | 'large' | 'unknown'
  readonly editable: boolean
  readonly diskVersion: string
  readonly hash?: string
}
export interface IdeFilePage {
  readonly files: readonly IdeFile[]
  readonly directories?: readonly { readonly path: string; readonly name: string }[]
  readonly total: number
  readonly revision: string
}
export interface IdeSearchMatch { readonly path:string; readonly line:number; readonly column:number; readonly text:string }
export interface IdeLocation { readonly path:string; readonly start:number; readonly length:number; readonly line:number; readonly column:number; readonly sourceVersion?:string; readonly sourceHash?:string }
export interface IdeDiagnostic extends IdeLocation { readonly severity:'error'|'warning'|'info'|'hint'; readonly message:string; readonly code:number|string }
export interface IdeCompletion { readonly name:string; readonly kind:string; readonly sortText:string; readonly insertText?:string; readonly replacementSpan?:{readonly start:number; readonly length:number} }
export interface IdeTextEdit { readonly start:number; readonly length:number; readonly newText:string }
export interface IdeReview {
  readonly id:string
  readonly status:string
  readonly files:readonly { readonly path:string; readonly before:string; readonly after:string; readonly expectedVersion:string }[]
  readonly conflicts?:readonly {readonly path:string; readonly reason?:string}[]
}
export type IdeLanguageOperation = 'diagnostics'|'completions'|'hover'|'definitions'|'references'|'format'|'rename'|'symbols'
export interface IdeLanguageResult {
  readonly riftId:string
  readonly path:string
  readonly generation:number
  readonly project:string
  readonly sourceVersion:string
  readonly sourceHash:string
  readonly durationMs:number
  readonly truncated:boolean
  readonly review?:IdeReview
  readonly result:
    | {readonly kind:'diagnostics'; readonly items:readonly IdeDiagnostic[]}
    | {readonly kind:'completions'; readonly items:readonly IdeCompletion[]}
    | {readonly kind:'hover'; readonly display?:string|null; readonly documentation?:string|null; readonly start?:number; readonly length?:number}
    | {readonly kind:'definitions'|'references'; readonly items:readonly IdeLocation[]}
    | {readonly kind:'symbols'; readonly items:readonly {readonly name:string; readonly kind:string; readonly start:number; readonly length:number; readonly children?:readonly unknown[]}[]}
    | {readonly kind:'format'|'rename'; readonly files:readonly {readonly path:string; readonly expectedVersion:string; readonly expectedHash:string; readonly edits:readonly IdeTextEdit[]}[]}
}
export interface IdeFilePreview { readonly encoding:'utf8'|'base64'|string; readonly text?:string; readonly base64?:string; readonly mimeType:string; readonly totalBytes:number; readonly truncated:boolean }

/** Process shapes are normalized by the application adapter, not by the component. */
export interface IdeTask {
  readonly id:string
  readonly title?:string
  readonly command:readonly string[]|string
  readonly cwd?:string
  readonly status:string
  readonly startedAt:string
  readonly finishedAt?:string
  readonly exitCode?:number|null
  readonly owner?:string
  readonly checkpointId?:string
  readonly recovery?:string
  readonly previewUrl?:string
  readonly kind?:'terminal'|'task'|'preview'
  readonly generation?:number
  readonly error?:string
}
export interface IdeTaskLog { readonly text:string; readonly cursor:number; readonly truncated?:boolean; readonly task?:IdeTask }
export interface IdeGitStatus {
  readonly branch?:string
  readonly head?:string
  readonly baseRef?:string
  readonly files:readonly {readonly path:string; readonly status:string; readonly oldPath?:string}[]
}

export interface DevelopmentIdeOperations {
  files:{args:{directory?:string;prefix?:string;query?:string;fuzzy?:boolean;offset?:number;limit?:number};result:IdeFilePage}
  open:{args:{path:string};result:DevelopmentFile}
  search:{args:{query:string;paths?:readonly string[];maxResults?:number};result:{matches:readonly IdeSearchMatch[];truncated:boolean}}
  language:{args:{path:string;operation:IdeLanguageOperation;offset?:number;newName?:string};result:IdeLanguageResult}
  'review-disk':{args:Record<string,never>;result:IdeReview}
  'apply-review':{args:{reviewId:string};result:IdeReview}
  'create-file':{args:{path:string;text:string};result:unknown}
  'rename-file':{args:{path:string;newPath:string;expectedDiskVersion:string};result:unknown}
  'delete-file':{args:{path:string;expectedDiskVersion:string};result:unknown}
  'file-preview':{args:{path:string;offset?:number;length?:number};result:IdeFilePreview}
  'git-status':{args:{baseRef?:string};result:IdeGitStatus}
  'git-diff':{args:{path?:string;baseRef?:string};result:{diff:string}}
  checkpoint:{args:Record<string,never>;result:{checkpoint:{id:string;[key:string]:unknown}}}
  commit:{args:{checkpointId:string;message:string;expectedParent?:string};result:{commit:string;refName:string}}
  'task-list':{args:Record<string,never>;result:{tasks:readonly IdeTask[]}}
  'task-start':{args:{command:string;cwd?:string;title?:string;kind?:'terminal'|'task';sessionId?:string};result:IdeTask}
  'task-log':{args:{taskId:string;cursor?:number};result:IdeTaskLog}
  'task-input':{args:{taskId:string;input:string};result:unknown}
  'task-cancel':{args:{taskId:string};result:IdeTask}
  'task-restart':{args:{taskId:string};result:IdeTask}
  'task-resize':{args:{taskId:string;cols:number;rows:number};result:unknown}
  'preview-start':{args:{package?:string};result:IdeTask}
  assignments:{args:Record<string,never>;result:{assignments:readonly DevelopmentParticipant[]}}
  'assign-task':{args:{name:string;task:string;status?:string};result:unknown}
}
export interface DevelopmentIdeService {
  request<K extends keyof DevelopmentIdeOperations>(riftId:string,operation:K,args:DevelopmentIdeOperations[K]['args']):Promise<DevelopmentIdeOperations[K]['result']>
  artifactUrl(riftId:string,path:string):string
}

/** Injected language behavior: read-only editor snapshots never replace Garden text. */
export interface DevelopmentEditorInput { readonly source:string; readonly offset:number }
export interface DevelopmentEditorTools {
  diagnostics(input:DevelopmentEditorInput):Promise<readonly {readonly from:number;readonly to:number;readonly severity:'error'|'warning'|'info'|'hint';readonly message:string}[]>
  completions(input:DevelopmentEditorInput):Promise<readonly IdeCompletion[]>
  hover(input:DevelopmentEditorInput):Promise<{readonly from:number;readonly to:number;readonly text:string}|null>
  command(action:'definitions'|'references'|'format'|'rename',input:DevelopmentEditorInput):void
  selection?(offset:number,line:number,column:number):void
}
export interface IdeTab {
  readonly id:string
  readonly entry:IdeFile
  readonly file:DevelopmentFile|null
  readonly provider:ProviderHandle|null
  readonly tools:DevelopmentEditorTools|null
  readonly preview?:IdeFilePreview
  readonly artifactUrl?:string
  readonly dirty:boolean
  readonly loading:boolean
  readonly error:string
}
export type IdePanel = 'problems'|'terminal'|'changes'|'preview'|'team'|'search'|'references'
export interface DevelopmentIdeState {
  readonly tree:IdeFilePage
  readonly directory:string
  readonly filter:string
  readonly treePending:boolean
  readonly quickOpen:{readonly open:boolean;readonly query:string;readonly pending:boolean;readonly files:readonly IdeFile[]}
  readonly search:{readonly query:string;readonly pending:boolean;readonly matches:readonly IdeSearchMatch[];readonly truncated:boolean}
  readonly tabs:readonly IdeTab[]
  readonly active:readonly [string|null,string|null]
  readonly focusPane:0|1
  readonly split:boolean
  readonly panel:IdePanel
  readonly panelOpen:boolean
  readonly diagnostics:readonly IdeDiagnostic[]
  readonly locations:readonly IdeLocation[]
  readonly languageStatus:string
  readonly cursor:{readonly offset:number;readonly line:number;readonly column:number}
  readonly reveal:{readonly tabId:string;readonly offset:number;readonly token:number}|null
  readonly review:IdeReview|null
  readonly git:IdeGitStatus|null
  readonly diff:string
  readonly tasks:readonly IdeTask[]
  readonly selectedTaskId:string|null
  readonly log:string
  readonly previewUrl:string|null
  readonly assignments:readonly DevelopmentParticipant[]
  readonly presence:readonly {readonly id:string;readonly name:string;readonly documentId:string;readonly path:string;readonly local:boolean;readonly observedAt:string}[]
  readonly renameRequest:number
  readonly checkpointId:string|null
  readonly commit:{readonly commit:string;readonly refName:string}|null
  readonly pending:string|null
  readonly error:string
}
export interface DevelopmentIdeIntent {
  readonly action:'directory'|'filter'|'more-files'|'open'|'close-tab'|'activate-tab'|'split'|'focus-pane'|'quick-open'|'quick-query'|'search'|'panel'|'language'|'apply-review'|'review-disk'|'dismiss-review'|'create-file'|'rename-file'|'delete-file'|'git-refresh'|'git-diff'|'checkpoint'|'commit'|'task-start'|'task-select'|'task-input'|'task-cancel'|'task-restart'|'task-resize'|'preview-start'|'assign-task'|'refresh-tasks'|'run-cell'
  readonly path?:string
  readonly id?:string
  readonly query?:string
  readonly panel?:IdePanel
  readonly pane?:0|1
  readonly offset?:number
  readonly line?:number
  readonly column?:number
  readonly text?:string
  readonly newPath?:string
  readonly operation?:IdeLanguageOperation
  readonly newName?:string
  readonly command?:string
  readonly cwd?:string
  readonly name?:string
  readonly raw?:boolean
  readonly cols?:number
  readonly rows?:number
}
