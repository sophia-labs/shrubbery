/** Local, synthetic workspace data; real renderWorkspace, sidebar, selection
 * bus/interpreter and Chromium pointer input. No full app/backend/account. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createServer, transformWithEsbuild, type Plugin } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(appDir, '../..')
const dependencyRoot = realpathSync(resolve(appDir, 'node_modules/vite')).split(`${sep}node_modules${sep}`)[0]!
const output = mkdtempSync(resolve(tmpdir(), 'demi-pointer-browser-'))
const base = '30e898ad502656af3504ea21a441eda03ed41400'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const gitSource = (path: string) => execFileSync('git', ['show', `${base}:${path}`], { cwd: repo, encoding: 'utf8' })
const paths = ['packages/components/src/mn-context-menu.ts', 'packages/components/src/mn-sidebar-panel.ts']
const original = new Map(paths.map(path => [resolve(repo, path), gitSource(path)]))
const sourceHashes = Object.fromEntries([...paths, 'apps/organism/src/main.ts'].map(path => [path, hash(readFileSync(resolve(repo, path)))]))
const main = readFileSync(resolve(appDir, 'src/main.ts'), 'utf8')
// Reuse this exact, inspected shell emitter body (no competing approximation).
const emitter = main.slice(main.indexOf('function createFaceSelectEmitter<T>()'), main.indexOf('const commentSelectEmitter ='))
if (!emitter.startsWith('function createFaceSelectEmitter<T>()')) throw Error('Shell emitter extraction failed')
const shellAnchor = (text: string) => {
  const body = text.slice(text.indexOf('function showSidebarNodeMenu('), text.indexOf('function showBreadcrumbDocumentMenu('))
  const match = body.match(/'top-(left|right)'/)
  if (!match) throw Error('Sidebar menu caller anchor not found')
  return match[0]
}
let phase: 'baseline' | 'candidate' = 'baseline'
const servedSources: Array<{phase:string;path:string;sha256:string;override:boolean}> = []
const shellStyles = [...readFileSync(resolve(appDir, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[0]).join('\n')
const entry = () => `
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import { GARDEN_DEFAULT, createSelectionBus } from '@shrubbery/nucleus'
import { renderWorkspace, installEdgeInterpreter } from '@shrubbery/runtime'
${emitter}
const root=document.querySelector('main'), menu=document.createElement('mn-context-menu');document.body.append(menu)
const sections=[{id:'documents',label:'Documents',nodes:[{id:'folder',label:'Folder',kind:'folder',expanded:true,children:[{id:'doc-a',label:'First document',kind:'document'},{id:'doc-b',label:'Second document',kind:'document',readOnly:true}]},...Array.from({length:40},(_,i)=>({id:'doc-'+i,label:'Document '+i,kind:'document'}))]}]
const emitter=createFaceSelectEmitter(),bus=createSelectionBus();let dispose=()=>{},selected=[],opened=[],events=[],expanded=false,missing=false,renders=0
const faces={'face:sidebar':{onOpen:cb=>emitter.subscribe(cb),toResource:raw=>({graphId:'synthetic',documentId:raw.documentId})},'face:editor':{navigate:resource=>{opened.push(resource);paint()}}}
function paint(){renders++;const config=missing?{...GARDEN_DEFAULT,edges:[]}:GARDEN_DEFAULT
renderWorkspace(config,{container:root,surface:true,app:'garden',rightCollapsed:true,panelLayout:{leftWidth:330,leftExpanded:expanded},sidebar:{sections,selectedIds:selected,capabilities:{multiSelect:true,contextMenu:true},presentation:expanded?'columns':'tree',columnPaths:{documents:['folder']},onSelectionChange:detail=>{selected=[...detail.ids];paint()},onNodeOpen:detail=>emitter.emit({documentId:detail.id}),onAction:detail=>{if(detail.action!=='node-menu')return;menu.items=[{id:'open',label:'Open'},{id:'disabled',label:'Unavailable',disabled:true},{id:'last',label:'Last command'}];menu.show({x:detail.clientX??240,y:detail.clientY??96},${shellAnchor(phase === 'baseline' ? gitSource('apps/organism/src/main.ts') : main)})}}});dispose();dispose=installEdgeInterpreter(config,faces,bus)}
document.addEventListener('click',event=>{const row=event.composedPath().find(n=>n instanceof HTMLElement&&n.dataset.nodeId);if(row)events.push({type:event.type,detail:event.detail,trusted:event.isTrusted,id:row.dataset.nodeId,connected:row.isConnected})},true)
window.__pointerProof={get state(){return {selected,opened,events,renders}},reset(){selected=[];opened=[];events=[];missing=false;expanded=false;paint()},columns(){expanded=true;paint()},missing(){missing=true;opened=[];paint()},move(x,y){menu.show({x,y})},reposition(x,y,count=3){menu.items=Array.from({length:count},(_,i)=>({id:'command-'+i,label:'Command '+i}));menu.show({x,y})},close(){menu.hide()},destroy(){dispose();menu.remove();root.replaceChildren()}}
paint()
`
const entryId = '/pointer-proof.ts', virtualId = '\0pointer-proof.ts'
const plugin: Plugin = { name: 'pointer-proof', enforce: 'pre',
  resolveId: id => id === entryId ? virtualId : null,
  async load(id) {
    if (id === virtualId) return (await transformWithEsbuild(entry(), 'pointer-proof.ts', {loader:'ts',target:'esnext'})).code
    const path = id.split('?')[0]!
    if (/\/packages\/(components\/src\/(mn-context-menu|mn-sidebar-panel)|runtime\/src\/(render-workspace|edge-interpreter))\.ts$/.test(path)) {
      if (!realpathSync(path).startsWith(repo + sep)) throw Error('Unexpected live module source: '+path)
      const override = phase === 'baseline' && original.has(path)
      servedSources.push({phase,path,sha256:hash(override?original.get(path)!:readFileSync(path)),override})
    }
    if (phase === 'baseline') return original.get(path) ?? null
    return null
  },
  configureServer(server) { server.middlewares.use((req,res,next) => {
    if (req.url !== '/') return next()
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${shellStyles}<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body:not([data-organism-debug]) main#host{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style></head><body><main id="host"></main><button id="outside" style="position:fixed;right:15px;top:40px;z-index:2000">Outside</button><script type="module" src="${entryId}"></script></body></html>`)
  }) } }
const server = await createServer({ root: appDir, configFile:false,plugins:[plugin],server:{host:'127.0.0.1',port:5413,strictPort:true,hmr:false,fs:{allow:[repo,dependencyRoot]}},logLevel:'warn'})
let browser: Browser|null=null, context: BrowserContext|null=null
const results: unknown[] = [], errors: string[] = [], terminal={contextClosed:false,browserClosed:false,serverClosed:false}
const timeout = setTimeout(()=>{errors.push('180-second witness deadline');void context?.close();void browser?.close();void server.close()},180_000)
async function probe(page: Page) {
  const checks: Record<string,boolean>={}, details: Record<string,unknown>={}
  const state=()=>page.evaluate(()=> (window as any).__pointerProof.state)
  await page.goto('http://127.0.0.1:5413/',{waitUntil:'domcontentloaded'})
  const row=page.locator('mn-sidebar-panel [data-node-id="doc-a"]');await row.waitFor({state:'visible'})
  const before=await row.elementHandle()
  await row.click({clickCount:1});await row.click({clickCount:2})
  const opened=await state();details.activation=opened
  checks.twoTrustedClicks=opened.events.length===2&&opened.events.every((event:any)=>event.trusted)&&opened.events[1].detail===2
  checks.twoClicksReachNavigation=opened.opened.length===2&&opened.opened.every((value:any)=>value.documentId==='doc-a')
  checks.rowSurvivesSelection=await row.evaluate((el,old)=>el===old,before)
  await page.locator('mn-sidebar-panel [data-node-id="doc-b"]').click({modifiers:['Meta']})
  checks.modifierOnlySelects=(await state()).opened.length===2&&(await state()).selected.length===2
  await row.focus();await page.keyboard.press('Enter');checks.keyboardOpens=(await state()).opened.length===3
  const box=await row.boundingBox();if(!box)throw Error('No pointer target box')
  const cursor={x:box.x+100,y:box.y+box.height/2}
  await page.mouse.click(cursor.x,cursor.y,{button:'right'})
  await page.locator('mn-context-menu[open]').waitFor();await page.waitForTimeout(150)
  const menuBox=await page.locator('mn-context-menu').boundingBox();details.cursor={cursor,menuBox}
  checks.cursorLowerRight=!!menuBox&&Math.abs(menuBox.x-cursor.x)<2&&Math.abs(menuBox.y-cursor.y)<2
  await page.screenshot({path:resolve(output,phase+'-pointer.png')})
  await page.evaluate(()=> (window as any).__pointerProof.move(440,300));await page.waitForTimeout(160)
  const sameItems=await page.locator('mn-context-menu').boundingBox();details.sameItems=sameItems
  checks.sameItemsReopenMoves=!!sameItems&&Math.abs(sameItems.x-440)<2&&Math.abs(sameItems.y-300)<2
  await page.evaluate(()=> (window as any).__pointerProof.reposition(480,360,5));await page.waitForTimeout(160)
  const moved=await page.locator('mn-context-menu').boundingBox();details.reopened=moved
  checks.reopenedMoves=!!moved&&Math.abs(moved.x-480)<2&&Math.abs(moved.y-360)<2
  await page.keyboard.press('Escape');checks.escapeDismisses=await page.locator('mn-context-menu[open]').count()===0
  const ellipsis=row.locator('.node-menu');await ellipsis.click();await page.waitForTimeout(150)
  const buttonBox=await ellipsis.boundingBox(),ellipsisBox=await page.locator('mn-context-menu').boundingBox();details.ellipsis={buttonBox,ellipsisBox}
  checks.ellipsisAtElementEdge=!!buttonBox&&!!ellipsisBox&&Math.abs(ellipsisBox.x-buttonBox.x)<2&&Math.abs(ellipsisBox.y-(buttonBox.y+buttonBox.height))<2
  await page.keyboard.press('Escape');checks.focusRestored=await ellipsis.evaluate(el=>el.getRootNode() instanceof ShadowRoot&&(el.getRootNode() as ShadowRoot).activeElement===el)
  await row.focus();await page.keyboard.press('Shift+F10');await page.waitForTimeout(150)
  const keyboardBox=await page.locator('mn-context-menu').boundingBox();const currentRowBox=await row.boundingBox()
  checks.keyboardMenuAtElementEdge=!!keyboardBox&&!!currentRowBox&&Math.abs(keyboardBox.x-currentRowBox.x)<2&&Math.abs(keyboardBox.y-currentRowBox.y-currentRowBox.height)<2
  await page.locator('#outside').click();checks.outsideDismisses=await page.locator('mn-context-menu[open]').count()===0
  await page.evaluate(()=> (window as any).__pointerProof.reposition(innerWidth-1,innerHeight-1,40));await page.waitForTimeout(150)
  const edge=await page.locator('mn-context-menu').boundingBox();details.edge=edge
  checks.edgeContained=!!edge&&edge.x>=7&&edge.y>=7&&edge.x+edge.width<=1280-7&&edge.y+edge.height<=820-7
  await page.locator('mn-context-menu [data-menu-item-id="command-39"]').scrollIntoViewIfNeeded()
  checks.longMenuScrollable=await page.locator('mn-context-menu .menu').evaluate(el=>el.scrollTop>0)
  await page.screenshot({path:resolve(output,phase+'-edge.png')});await page.keyboard.press('Escape')
  await page.evaluate(()=> (window as any).__pointerProof.missing());await row.click();checks.missingEdgeIsExplicitNoop=(await state()).opened.length===0
  await page.evaluate(()=> (window as any).__pointerProof.reset());await page.evaluate(()=> (window as any).__pointerProof.columns());
  const column=page.locator('mn-sidebar-panel [data-column-node][data-node-id="doc-a"]');await column.click();await column.click({clickCount:2})
  checks.columnClicksReachNavigation=(await state()).opened.length===2
  await page.evaluate(()=> (window as any).__pointerProof.destroy())
  return {phase,checks,details}
}
try {
  await server.listen();browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync']})
  for (const next of ['baseline','candidate'] as const) {
    phase=next;server.moduleGraph.invalidateAll()
    context=await browser.newContext({viewport:{width:1280,height:820}})
    await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:5413'?route.continue():route.abort())
    const page=await context.newPage();page.setDefaultTimeout(15_000);page.on('pageerror',error=>errors.push(`${phase}: ${error.stack??error.message}`))
    results.push(await probe(page));await context.close();context=null
  }
  const candidate=(results[1] as any).checks
  for (const phase of ['baseline','candidate']) for(const path of paths) {
    const served=servedSources.find(item=>item.phase===phase&&item.path===resolve(repo,path))
    if(!served||served.override!==(phase==='baseline')||served.sha256!==(phase==='baseline'?hash(gitSource(path)):sourceHashes[path]))throw Error('Unbound served component source: '+phase+' '+path)
  }
  if(Object.values(candidate).some(value=>value!==true))throw Error('Candidate checks failed: '+JSON.stringify(candidate))
  if(errors.length)throw Error(errors.join('\n'))
} catch(error) { errors.push(String(error));process.exitCode=1 }
finally {
  clearTimeout(timeout)
  if(context)await context.close();terminal.contextClosed=true
  if(browser)await browser.close();terminal.browserClosed=browser?.isConnected()===false
  await server.close();terminal.serverClosed=server.httpServer?.listening===false
  const receipt={status:process.exitCode?'failed':'passed',base,sourceHashes,servedSources,emitterHash:hash(emitter),scope:'Synthetic data, real runtime/interpreter/component and trusted Chromium pointer events; no backend/native/Sirin',results,errors,terminal}
  writeFileSync(resolve(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n')
  console.log(JSON.stringify({output,...receipt},null,2))
}
