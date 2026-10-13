import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.js'
export default mergeConfig(base, defineConfig({ test: {
  execArgv: ['--localstorage-file=/tmp/vitest-hoja-custom-css-settings-20260908.json'],
} }))
