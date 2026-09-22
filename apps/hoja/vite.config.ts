import { defineConfig } from 'vite'

// Dev flow: run `soil app <folder> --no-open` (port 7777) for the seeds API,
// then `pnpm dev` here; /api is proxied to soil. The production shape is the
// reverse — soil serves this app's built dist itself.
export default defineConfig({
  root: '.',
  // Local Soil serves at `/`; the canary artifact opts into `/hoja/` through
  // `pnpm build:cloud` without forking source or asset paths.
  base: process.env.HOJA_BASE_PATH?.trim() || '/',
  server: {
    port: 5190,
    proxy: {
      '/api': 'http://127.0.0.1:7777',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
