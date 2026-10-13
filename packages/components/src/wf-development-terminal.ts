import {LitElement,css,html,unsafeCSS,type PropertyValues} from 'lit'
import {customElement,property} from 'lit/decorators.js'
import {Terminal} from '@xterm/xterm'
import {FitAddon} from '@xterm/addon-fit'
import xtermCss from '@xterm/xterm/css/xterm.css?inline'

/** A terminal display/input attachment; process ownership stays in the service. */
@customElement('wf-development-terminal')
export class WfDevelopmentTerminal extends LitElement{
  @property({type:String}) output=''
  @property({type:String}) sessionId=''
  @property({type:Boolean}) running=false
  static styles=css`${unsafeCSS(xtermCss)}:host{display:block;height:210px;min-height:100px;background:#17201b}.terminal{height:100%;padding:8px}`
  private terminal:Terminal|null=null
  private fit:FitAddon|null=null
  private observer:ResizeObserver|null=null
  private previous=''
  private cols=0
  private rows=0
  private cleanup:(()=>void)[]=[]
  connectedCallback():void{super.connectedCallback();if(this.hasUpdated)void this.updateComplete.then(()=>this.mount())}
  protected firstUpdated():void{this.mount()}
  private mount():void{
    if(this.terminal||!this.isConnected)return
    this.previous='';this.cols=0;this.rows=0
    const terminal=new Terminal({fontSize:12,fontFamily:'ui-monospace, SFMono-Regular, monospace',cursorBlink:true,scrollback:6000,convertEol:true,theme:{background:'#17201b',foreground:'#dde8db',cursor:'#b0d5a6'},allowProposedApi:false})
    const fit=new FitAddon();terminal.loadAddon(fit);terminal.open(this.renderRoot.querySelector('.terminal') as HTMLElement)
    this.terminal=terminal;this.fit=fit
    const input=terminal.onData(data=>{if(this.running)this.dispatchEvent(new CustomEvent('ide-terminal-input',{detail:{input:data},bubbles:true,composed:true}))})
    this.cleanup.push(()=>input.dispose())
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this)
    this.resize();this.write()
  }
  protected updated(changed:PropertyValues<this>):void{
    if(changed.has('sessionId')){this.terminal?.reset();this.previous='';this.cols=0;this.rows=0}
    if(changed.has('output')||changed.has('sessionId'))this.write()
    if(changed.has('running'))this.resize()
  }
  private write():void{
    if(!this.terminal)return
    if(this.output.startsWith(this.previous))this.terminal.write(this.output.slice(this.previous.length))
    else{this.terminal.reset();this.terminal.write(this.output)}
    this.previous=this.output
  }
  private resize():void{
    if(!this.terminal||!this.fit||!this.isConnected)return
    try{this.fit.fit()}catch{return}
    const cols=Math.max(20,Math.min(500,this.terminal.cols)),rows=Math.max(5,Math.min(200,this.terminal.rows))
    if(this.running&&(cols!==this.cols||rows!==this.rows)){this.cols=cols;this.rows=rows;this.dispatchEvent(new CustomEvent('ide-terminal-resize',{detail:{cols,rows},bubbles:true,composed:true}))}
  }
  disconnectedCallback():void{this.observer?.disconnect();this.cleanup.splice(0).forEach(dispose=>dispose());this.terminal?.dispose();this.terminal=null;super.disconnectedCallback()}
  render(){return html`<div class="terminal" role="group" aria-label="Interactive terminal"></div>`}
}
declare global{interface HTMLElementTagNameMap{'wf-development-terminal':WfDevelopmentTerminal}}
