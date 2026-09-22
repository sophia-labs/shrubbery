import { resolve } from 'node:path'

// Standalone Vite demo for <mn-vtuber> (see ./README.md). It imports package
// source directly by relative path (../src, ../../tokens, ../../nucleus), so the
// dev server's fs root is the monorepo root and fs.allow spans it. No external
// or machine-specific model directory is wired here — point the "Model URL"
// control at your own .vrm (an http(s) URL, or a /@fs/<abs-path> handle to a
// file under an fs.allow root you add below).
const repoRoot = resolve(__dirname, '../../..')

export default {
  root: repoRoot,
  optimizeDeps: {
    entries: [resolve(__dirname, 'index.html')],
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
}
