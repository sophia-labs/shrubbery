import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dynamicCellProxy } from '../../scripts/vite-cell-proxy.js'

const appDir = dirname(fileURLToPath(import.meta.url))
const manifestPath = process.env.GARDEND_LOOPBACK_MANIFEST
  ? resolve(process.env.GARDEND_LOOPBACK_MANIFEST)
  : resolve(appDir, '.gardend-loopback.json')

export default defineConfig({
  root: '.',
  plugins: [dynamicCellProxy({ manifestPath })],
  server: { port: 5188 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
