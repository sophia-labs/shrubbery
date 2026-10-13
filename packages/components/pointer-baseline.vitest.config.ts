/** Offline red control: the same candidate assertions against exact 30e source. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import config from './vitest.config.js'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const paths = ['packages/components/src/mn-context-menu.ts', 'packages/components/src/mn-sidebar-panel.ts']
const originals = new Map(paths.map(path => {
  const source = execFileSync('git', ['show', `30e898ad502656af3504ea21a441eda03ed41400:${path}`], {cwd:repo,encoding:'utf8'})
  console.log(JSON.stringify({control:'exact baseline source',path,sha256:createHash('sha256').update(source).digest('hex')}))
  return [resolve(repo,path),source]
}))
export default defineConfig({
  ...config,
  plugins:[{name:'exact-pointer-baseline',enforce:'pre',load(id){return originals.get(id.split('?')[0]!)??null}}],
  test:{...config.test,include:['src/__tests__/mn-context-menu.test.ts','src/__tests__/mn-sidebar-panel.test.ts'],maxWorkers:1,fileParallelism:false},
})
