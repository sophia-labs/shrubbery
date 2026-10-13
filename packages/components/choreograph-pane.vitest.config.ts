import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.js'
export default mergeConfig(base, defineConfig({test:{execArgv:[`--localstorage-file=/tmp/vitest-choreograph-pane-components-${process.pid}.json`],fileParallelism:false,maxWorkers:1}}))
