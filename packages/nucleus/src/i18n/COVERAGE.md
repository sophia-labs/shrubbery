# Japanese localization coverage — 2026-10-22

The catalogs contain **2189 typed English keys and 2189 Japanese entries**. English text is the key for fixed copy; composed messages use semantic keys and named parameters. Product/font/keyboard names intentionally retained verbatim are listed in `ja.ts`.

This is a broad first pass, **not complete localization of every visible surface**. Static labels, template text, accessibility labels, and many structured UI models have been converted. Some composed messages, service-generated notices, schema/class labels, and older surfaces remain in English. Developer-only/debug/test-harness copy is excluded.

Counts below are production translation-call occurrences grouped by source file, not unique catalog keys. Calls with a computed key count once. “Known static remainder” counts complete literal text/attributes still found by a conservative source inventory; it is a lower bound and excludes composed text and external data. Shared chrome includes authentication, sharing, search, history, and shell orchestration in `main.ts`.

| Surface family | Coverage | Localized calls | Changed UI files | Known static remainder |
| --- | --- | ---: | ---: | ---: |
| App shell and shared chrome | Partially converted | 951 | 78 | 2 |
| Settings and billing | Partially converted | 257 | 8 | 0 |
| Shared dialogs | Partially converted | 14 | 7 | 0 |
| Document editor chrome and pickers | Partially converted | 190 | 8 | 0 |
| Whiteboard and wires | Partially converted | 172 | 9 | 0 |
| Files explorer and canvas | Partially converted | 204 | 10 | 0 |
| Workflow canvas and controls | Partially converted | 237 | 5 | 0 |
| Compute | Partially converted | 18 | 3 | 0 |
| Reader | Partially converted | 191 | 6 | 0 |
| Object pages, beings and cast | Partially converted | 170 | 13 | 0 |
| Public sites | Partially converted | 121 | 3 | 0 |
| Chat chrome | Partially converted | 104 | 1 | 0 |

## API and locale lifecycle

- `t(key: MessageKey, params?: MessageParams): string` uses the active locale. `{name}` placeholders interpolate plain text. Plural messages use `count` with `Intl.PluralRules`; a missing translation falls back per key to English and English plural rules.
- `translate(locale, key, params?, catalog?)` supports explicit-locale rendering and a partial catalog, including fallback tests.
- `formatDate(value, options?, locale?)` and `formatNumber(value, options?, locale?)` use `Intl` and the active locale by default.
- `resolveLocale(explicit?, browserLanguage?)` resolves the explicit setting, then the supplied browser language, then `en`. Supported locales are `en` and `ja`; unsupported languages resolve to English.
- `localeSource.get()/set()/subscribe()` is a DOM-free source with the existing subscription shape. `LocaleController` implements Lit’s structural controller lifecycle without importing Lit; runtime re-exports it. Components subscribe directly to the same nucleus source to preserve their dependency boundary.
- Runtime `installLocale()` initializes from `shrubbery.locale` or `navigator.language`, synchronizes `<html lang>`, and watches cross-tab storage changes. Importing runtime installs this browser edge when a browser exists. `setLanguage()` persists the explicit preference. Settings → Appearance includes Language: English / 日本語.
- Both Excalidraw hosts receive `ja-JP` for Japanese and re-render React with the existing key and scene when language changes. Controllers and the imperative whiteboard selection bar release subscriptions on teardown.
- Static UI metadata uses getters so translated labels are resolved when read, including menus created before a language change. `localizeLabel()` is for caller-owned interface copy only; document content, titles, personal names, and user-defined schema labels retain their original text.

## Tests written; validation deliberately unrun

Core tests cover interpolation, plural selection, English fallback (including fallback plural grammar), locale resolution, subscriptions, and Intl formatting. The catalog test checks key parity, nonempty/nonidentical translations with an explicit allowlist, and interpolation-parameter parity. The nucleus purity roster includes all three i18n modules.

Japanese render tests cover chat chrome, shell chrome, Settings, confirm/input/choice dialogs, editor chrome, whiteboard chrome, Files explorer and canvas empty states, workflow chrome and canvas, Compute, reader controls, object empty states, beings/cast, public-site navigation, and live locale changes with disconnect/reconnect. Tests use real elements and plain data, with no mocks.

No builds, type-checkers, or test suites were run. Only source inspection and `git diff --check` were used. Claude owns combined validation and commit. No package manifest, lockfile, Git index, or Git history changes were made.

## Remaining work and uncertainties

- Composed workflow/run progress and telemetry sentences remain in parts of `main.ts`, workflow focus/inspector views, archive/continuation views, and Agent status surfaces. Backend error text is displayed as supplied.
- Settings service descriptions and the local-AI/import/maintenance providers contain additional copy beyond the converted settings renderer and common controls. Some cached or service-generated text needs explicit locale invalidation.
- File-kind evidence descriptions, source-specific information panels, archive/continuation counts, and older PDF tools still have composed English text. User-defined class/field names and graph data are intentionally preserved; they need localized schema metadata rather than UI string substitution.
- The chat panel has localized composer/voice/action chrome, while some composed tool/progress details remain in English. Additional older components and public landing-page fragments need extraction; the static inventory below lists concrete examples. The catalog also contains prepared translations not yet wired into every call site.
- The wire taxonomy’s English `requires` and `consequenceOf` labels appear inconsistent with their A/B explanatory direction. Both were translated as written; semantic direction/URI behavior was retained.
- Japanese layout fit has not been checked in a browser. No label was shortened to force a fit; review compact toolbars, whiteboard selection actions, selectors, and long confirmation text.
- Standalone component consumers must supply the locale source themselves; runtime-backed Organism/Planter entry points initialize from the browser. Server-rendered content defaults to English unless the caller explicitly selects a locale.

## Known remaining complete static strings

### App shell and shared chrome

- `packages/components/src/mn-energy-ledger.ts`: the receipt's joules: the World's own units
- `packages/components/src/mn-energy-ledger.ts`: Touches

## Every changed file

167 files, including this report.

- [apps/organism/src/cell/add-credits-view.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/add-credits-view.ts)
- [apps/organism/src/cell/app-routes.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/app-routes.ts)
- [apps/organism/src/cell/billing-copy.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/billing-copy.ts)
- [apps/organism/src/cell/credit-history-view.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/credit-history-view.ts)
- [apps/organism/src/cell/flow-app-frame.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/flow-app-frame.ts)
- [apps/organism/src/cell/grapevine-pane.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/grapevine-pane.ts)
- [apps/organism/src/cell/pdf-reader/pdf-reader.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/pdf-reader/pdf-reader.ts)
- [apps/organism/src/cell/phanes-control-editor.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/phanes-control-editor.ts)
- [apps/organism/src/cell/reader/__tests__/i18n.test.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/reader/__tests__/i18n.test.ts)
- [apps/organism/src/cell/reader/mn-reader.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/reader/mn-reader.ts)
- [apps/organism/src/cell/reader/reader-bar.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/reader/reader-bar.ts)
- [apps/organism/src/cell/reader/reader-contents.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/reader/reader-contents.ts)
- [apps/organism/src/cell/settings-service.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/settings-service.ts)
- [apps/organism/src/cell/usage-explorer-view.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/usage-explorer-view.ts)
- [apps/organism/src/cell/usage-explorer.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/usage-explorer.ts)
- [apps/organism/src/cell/vocab-views.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/cell/vocab-views.ts)
- [apps/organism/src/main.ts](/Users/vera/dev/shrubbery-i18n-20261022/apps/organism/src/main.ts)
- [packages/chat-kernel/src/__tests__/i18n.test.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/chat-kernel/src/__tests__/i18n.test.ts)
- [packages/chat-kernel/src/chat-panel.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/chat-kernel/src/chat-panel.ts)
- [packages/components/src/__tests__/i18n-surfaces.test.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/__tests__/i18n-surfaces.test.ts)
- [packages/components/src/app-toolbar.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/app-toolbar.ts)
- [packages/components/src/file-pane-model.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/file-pane-model.ts)
- [packages/components/src/garden-landing.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/garden-landing.ts)
- [packages/components/src/mn-access-manager.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-access-manager.ts)
- [packages/components/src/mn-advanced-wire-menu.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-advanced-wire-menu.ts)
- [packages/components/src/mn-api-key-manager.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-api-key-manager.ts)
- [packages/components/src/mn-app-bar.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-app-bar.ts)
- [packages/components/src/mn-artifact-editor.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-artifact-editor.ts)
- [packages/components/src/mn-artifact-history.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-artifact-history.ts)
- [packages/components/src/mn-artifact-view.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-artifact-view.ts)
- [packages/components/src/mn-audio-player.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-audio-player.ts)
- [packages/components/src/mn-auth-page.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-auth-page.ts)
- [packages/components/src/mn-bottom-bar.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-bottom-bar.ts)
- [packages/components/src/mn-calendar-event-specimen.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-calendar-event-specimen.ts)
- [packages/components/src/mn-citation-picker.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-citation-picker.ts)
- [packages/components/src/mn-cloud-mode-panel.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-cloud-mode-panel.ts)
- [packages/components/src/mn-cloud-mode-pill.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-cloud-mode-pill.ts)
- [packages/components/src/mn-comment-popover.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-comment-popover.ts)
- [packages/components/src/mn-comments-panel.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-comments-panel.ts)
- [packages/components/src/mn-confirmation-dialog.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-confirmation-dialog.ts)
- [packages/components/src/mn-consent-banner.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-consent-banner.ts)
- [packages/components/src/mn-context-menu.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-context-menu.ts)
- [packages/components/src/mn-daily-note-header.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-daily-note-header.ts)
- [packages/components/src/mn-daily-note-row.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-daily-note-row.ts)
- [packages/components/src/mn-dialog.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-dialog.ts)
- [packages/components/src/mn-doc-history-panel.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-doc-history-panel.ts)
- [packages/components/src/mn-document-outline.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-document-outline.ts)
- [packages/components/src/mn-document-switcher.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-document-switcher.ts)
- [packages/components/src/mn-editor-toolbar.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-editor-toolbar.ts)
- [packages/components/src/mn-empty-state.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-empty-state.ts)
- [packages/components/src/mn-error-boundary.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-error-boundary.ts)
- [packages/components/src/mn-excalidraw-canvas.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-excalidraw-canvas.ts)
- [packages/components/src/mn-export-dialog.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-export-dialog.ts)
- [packages/components/src/mn-feedback-form.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-feedback-form.ts)
- [packages/components/src/mn-file-info.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-file-info.ts)
- [packages/components/src/mn-folder-picker-dialog.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-folder-picker-dialog.ts)
- [packages/components/src/mn-garden-home.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-garden-home.ts)
- [packages/components/src/mn-graph-panel.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-graph-panel.ts)
- [packages/components/src/mn-graph-three.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-graph-three.ts)
- [packages/components/src/mn-home-view.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-home-view.ts)
- [packages/components/src/mn-inline-edit.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-inline-edit.ts)
- [packages/components/src/mn-input-dialog.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-input-dialog.ts)
- [packages/components/src/mn-input.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-input.ts)
- [packages/components/src/mn-inspector.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-inspector.ts)
- [packages/components/src/mn-lifetime-banner.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-lifetime-banner.ts)
- [packages/components/src/mn-loading.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-loading.ts)
- [packages/components/src/mn-mobile-file-list.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-mobile-file-list.ts)
- [packages/components/src/mn-mobile-tabs.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-mobile-tabs.ts)
- [packages/components/src/mn-modal.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-modal.ts)
- [packages/components/src/mn-month-popover.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-month-popover.ts)
- [packages/components/src/mn-mus-take-player.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-mus-take-player.ts)
- [packages/components/src/mn-node-link-picker.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-node-link-picker.ts)
- [packages/components/src/mn-original-viewer.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-original-viewer.ts)
- [packages/components/src/mn-presence-inspector.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-presence-inspector.ts)
- [packages/components/src/mn-public-shell.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-public-shell.ts)
- [packages/components/src/mn-quick-clip.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-quick-clip.ts)
- [packages/components/src/mn-research-run-trace.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-research-run-trace.ts)
- [packages/components/src/mn-research-source-card.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-research-source-card.ts)
- [packages/components/src/mn-research-workspace.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-research-workspace.ts)
- [packages/components/src/mn-restore-overlay.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-restore-overlay.ts)
- [packages/components/src/mn-ribbon.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-ribbon.ts)
- [packages/components/src/mn-search-input.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-search-input.ts)
- [packages/components/src/mn-settings-page.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-settings-page.ts)
- [packages/components/src/mn-shortcuts-dialog.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-shortcuts-dialog.ts)
- [packages/components/src/mn-sidebar-panel.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-sidebar-panel.ts)
- [packages/components/src/mn-snapshot-diff.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-snapshot-diff.ts)
- [packages/components/src/mn-storage-banner.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-storage-banner.ts)
- [packages/components/src/mn-tag-autocomplete-popover.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-tag-autocomplete-popover.ts)
- [packages/components/src/mn-tag-view.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-tag-view.ts)
- [packages/components/src/mn-timeline-rail.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-timeline-rail.ts)
- [packages/components/src/mn-toast.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-toast.ts)
- [packages/components/src/mn-toolbar.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-toolbar.ts)
- [packages/components/src/mn-top-bar.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-top-bar.ts)
- [packages/components/src/mn-tts-player.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-tts-player.ts)
- [packages/components/src/mn-upgrade-banner.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-upgrade-banner.ts)
- [packages/components/src/mn-wikilink-picker.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-wikilink-picker.ts)
- [packages/components/src/mn-wire-menu-dropdown.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-wire-menu-dropdown.ts)
- [packages/components/src/mn-wire-picker.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-wire-picker.ts)
- [packages/components/src/mn-wire-radial-overlay.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-wire-radial-overlay.ts)
- [packages/components/src/mn-workspace-selector.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-workspace-selector.ts)
- [packages/components/src/mn-zotero-library-panel.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-zotero-library-panel.ts)
- [packages/components/src/mn-zotero-source-workbench.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/mn-zotero-source-workbench.ts)
- [packages/components/src/sophia-labs-landing.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/sophia-labs-landing.ts)
- [packages/components/src/sophia-suite.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/sophia-suite.ts)
- [packages/components/src/wf-agent-status-view.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/wf-agent-status-view.ts)
- [packages/components/src/wf-studio-shell.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/components/src/wf-studio-shell.ts)
- [packages/editor-kernel/src/extensions/slash-command.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/editor-kernel/src/extensions/slash-command.ts)
- [packages/nucleus/src/__tests__/no-lit-leak.fitness.test.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/__tests__/no-lit-leak.fitness.test.ts)
- [packages/nucleus/src/i18n/COVERAGE.md](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/i18n/COVERAGE.md)
- [packages/nucleus/src/i18n/GLOSSARY.md](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/i18n/GLOSSARY.md)
- [packages/nucleus/src/i18n/catalog.test.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/i18n/catalog.test.ts)
- [packages/nucleus/src/i18n/en.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/i18n/en.ts)
- [packages/nucleus/src/i18n/i18n.test.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/i18n/i18n.test.ts)
- [packages/nucleus/src/i18n/index.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/i18n/index.ts)
- [packages/nucleus/src/i18n/ja.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/i18n/ja.ts)
- [packages/nucleus/src/index.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/index.ts)
- [packages/nucleus/src/object-faces/being.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/object-faces/being.ts)
- [packages/nucleus/src/shortcut-catalog.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/shortcut-catalog.ts)
- [packages/nucleus/src/wire-predicates.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/wire-predicates.ts)
- [packages/nucleus/src/workspace/files-evidence.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/nucleus/src/workspace/files-evidence.ts)
- [packages/runtime/src/__tests__/i18n-surfaces.test.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/__tests__/i18n-surfaces.test.ts)
- [packages/runtime/src/__tests__/locale.test.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/__tests__/locale.test.ts)
- [packages/runtime/src/being/being-face-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/being/being-face-element.ts)
- [packages/runtime/src/center-panes-host.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/center-panes-host.ts)
- [packages/runtime/src/chat-host/chat-host.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/chat-host/chat-host.ts)
- [packages/runtime/src/chat-host/continue-chooser.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/chat-host/continue-chooser.ts)
- [packages/runtime/src/chat-host/conversation-archive-view.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/chat-host/conversation-archive-view.ts)
- [packages/runtime/src/editor-host.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/editor-host.ts)
- [packages/runtime/src/excalidraw/excalidraw-runtime.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/excalidraw/excalidraw-runtime.ts)
- [packages/runtime/src/files-canvas/files-canvas-host.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/files-canvas/files-canvas-host.ts)
- [packages/runtime/src/files-canvas/files-empty.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/files-canvas/files-empty.ts)
- [packages/runtime/src/files-page.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/files-page.ts)
- [packages/runtime/src/files-pane.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/files-pane.ts)
- [packages/runtime/src/graph-host.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/graph-host.ts)
- [packages/runtime/src/index.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/index.ts)
- [packages/runtime/src/layout/faces/agent-entry-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/agent-entry-view-element.ts)
- [packages/runtime/src/layout/faces/agent-session-family-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/agent-session-family-view-element.ts)
- [packages/runtime/src/layout/faces/compute-cell-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/compute-cell-view-element.ts)
- [packages/runtime/src/layout/faces/cuenta-chapter-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/cuenta-chapter-view-element.ts)
- [packages/runtime/src/layout/faces/doc-history-face.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/doc-history-face.ts)
- [packages/runtime/src/layout/faces/home-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/home-view-element.ts)
- [packages/runtime/src/layout/faces/inbox-room-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/inbox-room-view-element.ts)
- [packages/runtime/src/layout/faces/letter-page-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/letter-page-view-element.ts)
- [packages/runtime/src/layout/faces/media-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/media-view-element.ts)
- [packages/runtime/src/layout/faces/my-work-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/my-work-view-element.ts)
- [packages/runtime/src/layout/faces/object-card-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/object-card-view-element.ts)
- [packages/runtime/src/layout/faces/seat-character-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/seat-character-view-element.ts)
- [packages/runtime/src/layout/faces/sparql-table-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/sparql-table-view-element.ts)
- [packages/runtime/src/layout/faces/stat-scalar-face.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/stat-scalar-face.ts)
- [packages/runtime/src/layout/faces/stat-scalar-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/stat-scalar-view-element.ts)
- [packages/runtime/src/layout/faces/subject-card-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/subject-card-view-element.ts)
- [packages/runtime/src/layout/faces/vega-chart-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/layout/faces/vega-chart-view-element.ts)
- [packages/runtime/src/locale.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/locale.ts)
- [packages/runtime/src/object-view/choice-dialog-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/object-view/choice-dialog-element.ts)
- [packages/runtime/src/object-view/injerto-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/object-view/injerto-element.ts)
- [packages/runtime/src/object-view/object-view-element.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/object-view/object-view-element.ts)
- [packages/runtime/src/picker/install-glue.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/picker/install-glue.ts)
- [packages/runtime/src/render-workspace.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/render-workspace.ts)
- [packages/runtime/src/whiteboard/arrow-wire.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/whiteboard/arrow-wire.ts)
- [packages/runtime/src/whiteboard/card-embed.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/whiteboard/card-embed.ts)
- [packages/runtime/src/whiteboard/selection-bar.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/whiteboard/selection-bar.ts)
- [packages/runtime/src/whiteboard/sh-whiteboard.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/whiteboard/sh-whiteboard.ts)
- [packages/runtime/src/wire-pinned-layer/wire-pinned-layer.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/wire-pinned-layer/wire-pinned-layer.ts)
- [packages/runtime/src/wires-panel/wires-panel.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/wires-panel/wires-panel.ts)
- [packages/runtime/src/workflow-focus.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/workflow-focus.ts)
- [packages/runtime/src/workflow-inspector.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/workflow-inspector.ts)
- [packages/runtime/src/workflow-scene.ts](/Users/vera/dev/shrubbery-i18n-20261022/packages/runtime/src/workflow-scene.ts)
