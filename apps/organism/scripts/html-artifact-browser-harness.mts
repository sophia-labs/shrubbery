/** Synthetic HTTP / in-process workspace hints; real decoder, controller,
 * runtime host and sandboxed iframe. This is NOT a native or deployed witness. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { createServer, type Plugin } from 'vite'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dependencyRoot = realpathSync(resolve(appDir, 'node_modules/vite')).split(`${sep}node_modules${sep}`)[0]!
const output = mkdtempSync(resolve(tmpdir(), 'demi-live-html-browser-'))
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appDir, encoding: 'utf8' }).trim()
const sourceClean = !execFileSync('git', ['status', '--porcelain'], { cwd: appDir, encoding: 'utf8' }).trim()
// The runtime intentionally emits no shell CSS. Use the actual app's frame
// stylesheet, not a guessed flex wrapper or legacy default render mode.
const shellStyles = [...readFileSync(resolve(appDir, 'index.html'), 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[0]).join('\n')
const port = 5401
const source = (version: number) => `<!doctype html><html><head><style>
*{box-sizing:border-box}body{margin:0;padding:clamp(18px,4vw,48px);background:#f1efe5;color:#243b31;font:16px/1.6 system-ui}h1{font:clamp(28px,5vw,48px)/1.1 Georgia;margin:12px 0 20px}.eyebrow{letter-spacing:.15em;font-size:12px;text-transform:uppercase;color:#526b5b}.card{background:#fffdf5;border:1px solid #bdcabb;border-radius:12px;padding:20px;margin:20px 0}button{font:inherit;border:1px solid #7d977d;border-radius:6px;padding:8px 14px;background:#dcebd6;color:#243b31}footer{margin-top:800px;border-top:1px solid #bdcabb;padding-top:16px}
</style></head><body><div class="eyebrow">The Garden field notebook · edition ${version}</div><h1>A small atlas of patient things</h1>
<p id="version">Committed edition ${version}</p><div class="card"><h2>Notes from the moss</h2><p>An artifact can change while its reader remains here. The page remembers its place until a new edition arrives.</p><button id="increment">Count a leaf</button> <output id="count">0</output></div>
<p>HTML, styles and an optional small script, held apart from Garden's own page.</p><footer id="last-item">The last entry is reachable by scrolling inside this artifact.</footer>
<script>
document.documentElement.dataset.boot = String(Math.random());
document.querySelector('#increment').onclick = () => document.querySelector('#count').textContent = String(Number(document.querySelector('#count').textContent)+1);
try { parent.document.documentElement.dataset.escaped='yes'; } catch { document.documentElement.dataset.parentDenied='yes'; }
try { localStorage.setItem('artifact-probe','no'); } catch { document.documentElement.dataset.storageDenied='yes'; }
fetch('/should-not-fetch').then(()=>document.documentElement.dataset.fetchDenied='no').catch(()=>document.documentElement.dataset.fetchDenied='yes');
window.open('/should-not-popup');
</script><script src="/should-not-script"></script><img alt="blocked external image" src="/should-not-image"></body></html>`
let text = source(1), generation = 1, deleted = false
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const requests: string[] = [], errors: string[] = [], consoleMessages: string[] = [], observations: unknown[] = []
const snapshot = () => ({ graphId: 'g', graphIncarnation: 'life-html-proof', artifactId: 'a', filename: 'atlas.html', mimeType: 'text/html; charset=utf-8', text, sizeBytes: Buffer.byteLength(text), contentHashSha256: hash(text) })
const entryId = '/html-proof-entry.ts', resolvedEntry = '\0html-proof-entry.ts'
const entry = String.raw`
import * as Y from 'yjs'
import '@shrubbery/tokens/tokens.css'
import '@shrubbery/components'
import { GARDEN_DEFAULT } from '@shrubbery/nucleus'
import { renderWorkspace } from '@shrubbery/runtime'
import { InProcessCrdtBackend } from '@shrubbery/runtime/harness/in-process-crdt-backend'
import { EditorRoomPool } from '/src/cell/editor-room-pool.ts'
import { ArtifactLivePreview, watchArtifactWorkspace } from '/src/cell/artifact-live-preview.ts'
import { fetchArtifactText } from '/src/cell/rest-helpers.ts'
const backend = new InProcessCrdtBackend(), pool = new EditorRoomPool(backend)
const contract = { auth:{token:()=>undefined,userId:()=> 'synthetic-user',whenReady:async()=>{},isAuthenticated:()=>true,onChange:()=>()=>{}},
 runtime:{mode:()=> 'local',isGateway:()=>false,graphBaseUrl:()=>location.origin} }
const workspace = pool.acquire({kind:'workspace',graphId:'g'},'fixture-writer')
const artifacts = workspace.provider.doc.getMap('artifacts')
const item = new Y.Map(); artifacts.set('a',item)
let current = {status:'loading',snapshot:null}, scripts = false, renderCount = 0, title = 'Patient things · HTML artifact'
const main = document.querySelector('main')
function paint() {
 renderCount++
 renderWorkspace(GARDEN_DEFAULT,{container:main,surface:true,leftCollapsed:innerWidth<700,rightCollapsed:true,viewMode:'document',artifact:{graphId:'g',artifactId:'a',title,mimeType:'text/html',status:current.status,error:current.error,
 previewHtml:current.snapshot?.text??null,previewIdentity:current.snapshot?.contentHashSha256??null,allowHtmlScripts:scripts,onRefresh:()=>controller.refresh()}})
}
const controller = new ArtifactLivePreview({read:signal=>fetchArtifactText(contract,'g','a',signal),
 watch:(invalidate,unavailable)=>watchArtifactWorkspace(contract,pool,'g','a',invalidate,unavailable),
 onChange:value=>{current=value;paint()}})
window.__htmlProof={get state(){return {current,renderCount,leases:pool.snapshot()}},
 async commit(kind='next'){const value=await (await fetch('/__fixture-commit',{method:'POST',body:kind})).json();item.set('contentHashSha256',value.contentHashSha256);item.set('contentOperationId',value.generation);},
 rerender(){title='Patient things · still here';paint()},
 scripts(value){scripts=value;paint()},
 refresh(){controller.refresh()},
 close(){controller.dispose();workspace.release();pool.destroyAll();backend.destroyAll();main.replaceChildren()}}
paint();controller.start()
window.addEventListener('beforeunload',()=>window.__htmlProof.close(),{once:true})
`
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTML artifact witness</title>${shellStyles}<style>html,body{width:100%;height:100%;margin:0;overflow:hidden}body{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:38px minmax(0,1fr);font:13px system-ui;background:#e9ede3}.proof-label{padding:8px 12px;color:#314434}body:not([data-organism-debug]) main#host{position:relative;min-height:0;min-width:0;height:100%;overflow:hidden;margin:0;padding:0}</style></head><body><div class="proof-label">Isolated HTML artifact witness · real Garden render host</div><main id="host"></main><script type="module" src="${entryId}"></script></body></html>`
const plugin: Plugin = { name: 'html-artifact-proof', resolveId: id => id === entryId ? resolvedEntry : null, load: id => id === resolvedEntry ? entry : null,
 configureServer(server) { server.middlewares.use((req,res,next) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (path.startsWith('/should-not-')) { requests.push(path); res.end('UNEXPECTED'); return }
  if (path === '/artifacts/g/a/text') { requests.push(path); res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type','application/json'); res.statusCode=deleted?404:200;res.end(JSON.stringify(deleted?{error:'deleted'}:snapshot()));return }
  if (path === '/__fixture-commit') { let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{generation++;deleted=body==='delete';if(body==='empty')text='';else if(body!=='same')text=source(generation);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({generation,contentHashSha256:hash(text)}))});return }
  if (path === '/') {res.setHeader('Content-Type','text/html');res.end(html);return}
  next()
 }) } }
const server = await createServer({root:appDir,configFile:false,plugins:[plugin],server:{host:'127.0.0.1',port,strictPort:true,hmr:false,fs:{allow:[resolve(appDir,'../..'),dependencyRoot]}},logLevel:'warn'})
let browser: Browser | null = null
const deadline = setTimeout(()=>{void browser?.close();void server.close()},120_000)
try {
 await server.listen();browser=await chromium.launch({headless:true,args:['--disable-background-networking','--disable-component-update','--disable-sync']})
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(15_000)
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'||/^(data|blob):/.test(route.request().url())?route.continue():route.abort())
 page.on('pageerror',error=>errors.push(error.message));page.on('console',msg=>{if(msg.type()==='error')consoleMessages.push(msg.text())})
 page.on('popup',()=>errors.push('Sandbox opened a popup'))
 page.on('response',response=>{if(response.status()>=400 && !(deleted&&response.status()===404&&response.url().endsWith('/artifacts/g/a/text')))errors.push(`HTTP ${response.status()}: ${response.url()}`)})
 await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=> (window as any).__htmlProof?.state.current.status==='ready')
 const frame=page.frameLocator('mn-artifact-view iframe')
 await frame.locator('#version').filter({hasText:'edition 1'}).waitFor()
 if(await frame.locator('html').getAttribute('data-boot'))throw Error('Default policy executed a script')
 await page.screenshot({path:resolve(output,'desktop-html.png')})
 await page.evaluate(()=> (window as any).__htmlProof.scripts(true))
 await frame.locator('html[data-fetch-denied="yes"][data-parent-denied="yes"][data-storage-denied="yes"]').waitFor()
 await frame.locator('#increment').click();if(await frame.locator('#count').textContent()!=='1')throw Error('Sandboxed inline interaction failed')
 const boot=await frame.locator('html').getAttribute('data-boot')
 await page.evaluate(()=> (window as any).__htmlProof.rerender())
 if(await frame.locator('html').getAttribute('data-boot')!==boot)throw Error('Unrelated render reset artifact')
 await page.evaluate(()=> (window as any).__htmlProof.commit('same'))
 await page.waitForFunction(()=> (window as any).__htmlProof.state.current.status==='ready')
 if(await frame.locator('html').getAttribute('data-boot')!==boot)throw Error('Same content reset artifact')
 await page.evaluate(()=> (window as any).__htmlProof.commit())
 await frame.locator('#version').filter({hasText:'edition 3'}).waitFor()
 if(await frame.locator('html').getAttribute('data-boot')===boot)throw Error('Changed content did not create new context')
 await page.setViewportSize({width:390,height:844})
 await page.evaluate(()=> (window as any).__htmlProof.rerender())
 await frame.locator('h1').scrollIntoViewIfNeeded()
 await page.screenshot({path:resolve(output,'mobile-html-top.png')})
 await frame.locator('#last-item').scrollIntoViewIfNeeded();await frame.locator('#last-item').waitFor({state:'visible'})
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Outer page overflows on mobile')
 const dimensions=await page.locator('mn-artifact-view iframe').evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height}})
 if(dimensions.width<250||dimensions.width>390||dimensions.height<200)throw Error('Artifact frame collapsed or too wide: '+JSON.stringify(dimensions))
 await page.screenshot({path:resolve(output,'mobile-html-scrolled.png')})
 observations.push({inlineScriptWorks:true,defaultInert:true,parentAndStorageDenied:true,sameSourceStable:true,committedUpdateObserved:true,mobile:dimensions})
 await page.evaluate(()=> (window as any).__htmlProof.scripts(false))
 await frame.locator('#version').waitFor();if(await frame.locator('html').getAttribute('data-boot'))throw Error('Disabling scripts kept executing context')
 await page.evaluate(()=> (window as any).__htmlProof.commit('empty'))
 await page.waitForFunction(()=> (window as any).__htmlProof.state.current.snapshot?.text==='')
 if(await page.locator('mn-artifact-view iframe').count()!==1)throw Error('Empty HTML lost its valid frame')
 await page.evaluate(()=> (window as any).__htmlProof.commit('delete'))
 await page.waitForFunction(()=> (window as any).__htmlProof.state.current.status==='error')
 if(await page.locator('mn-artifact-view iframe').count())throw Error('Deleted artifact still renders')
 if(requests.some(path=>path.startsWith('/should-not-')))throw Error('Sandbox subresource/popup request escaped: '+requests.join(','))
 if(errors.length)throw Error(errors.join('\n'))
 await page.evaluate(()=> (window as any).__htmlProof.close())
 observations.push({closedLeases:await page.evaluate(()=> (window as any).__htmlProof.state.leases),emptyHtmlValid:true,deletionCleared:true})
 if(execFileSync('git',['rev-parse','HEAD'],{cwd:appDir,encoding:'utf8'}).trim()!==sourceRevision)throw Error('Source moved during witness')
 writeFileSync(resolve(output,'receipt.json'),JSON.stringify({status:'passed',sourceRevision,sourceClean,scope:'synthetic HTTP and workspace hints; actual decoder/controller/Y.Doc/runtime/component/Chromium; not native, full app or production',requests,observations,errors,consoleMessages},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',output,requests:requests.length}))
} catch(error) {writeFileSync(resolve(output,'receipt.json'),JSON.stringify({status:'failed',error:String(error),requests,observations,errors,consoleMessages},null,2)+'\n');console.error(JSON.stringify({status:'failed',output,error:String(error)}));process.exitCode=1}
finally {clearTimeout(deadline);await browser?.close();await server.close()}
