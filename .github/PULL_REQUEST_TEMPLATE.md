## What changed and why

<!-- One or two sentences. Link the issue if there is one. For a visible change, add a screenshot. -->

## Run locally before opening this PR

- [ ] `pnpm lint`
- [ ] `pnpm -r --no-bail run typecheck`
- [ ] `node scripts/validate-no-mocks.mjs`
- [ ] `pnpm test:source`
- [ ] `pnpm -r run build`
- [ ] `pnpm test:real` (Chromium and WebKit), if you touched the editor, the shell or anything a browser renders

Tests drive real code against real inputs: no mocks. A merge to `main` ships the hosted app, so say here if the change
needs anything else (a gardend change, a setting, a migration).
