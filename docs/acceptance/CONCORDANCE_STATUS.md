# Shrubbery concordance campaign — generated status

Generated from `concordance-campaign.json`. Do not hand-edit this file.

- UX oracle: `da66b0ad01e4be64d666b63b8e3d873c37972887` in `../sophia/mnemosyne-platform`
- Target HEAD: `6047cd7de95d52d890d5cf0ce84238eb81817285` (clean)
- Target fingerprint: `a3473a2737995dcf0628060c3d5f002e15b1b4352fb979d92b6e2ebb6b9790c6`
- Coverage: 80/80 capabilities; 69/69 OG custom elements; 108/108 target custom elements
- Findings by status: audit-required=6, specified=7, in-progress=1, proof-candidate=10, proven=0, blocked=0, intentional-departure=0

## Lanes

| Lane | Priority | Status | Capabilities | Findings | Title |
|---|---:|---|---:|---:|---|
| CONC-L00 | P0 | in-progress | 4 | 4 | Acceptance, visual system, accessibility, and cross-cutting truth |
| CONC-L01 | P1 | audit-required | 7 | 0 | Routes, authentication, sharing, public reading, and operator surfaces |
| CONC-L02 | P0 | in-progress | 4 | 6 | Shell topology, panes, top bar, commands, and responsive posture |
| CONC-L03 | P0 | in-progress | 7 | 2 | Home, workspace catalog, tenancy, graph handoff, and storage truth |
| CONC-L04 | P0 | in-progress | 6 | 1 | File pane, sidebar organization, daily notes, pins, and search |
| CONC-L05 | P0 | in-progress | 9 | 3 | Editor core, rich structure, outliner, find, and TTS |
| CONC-L06 | P1 | in-progress | 5 | 1 | Wikilinks, images, tags, citations, and comments |
| CONC-L07 | P0 | in-progress | 2 | 3 | Presence identity, awareness lifecycle, reconnect, and convergence |
| CONC-L08 | P1 | proof-candidate | 9 | 1 | Graph, wires, inspector, SPARQL, Vega, and Mermaid |
| CONC-L09 | P1 | audit-required | 5 | 0 | Artifacts, Excalidraw, image generation, Zotero, and research surfaces |
| CONC-L10 | P1 | in-progress | 16 | 2 | Settings, history, restore, import, originals, export, and Local AI |
| CONC-L11 | P1 | audit-required | 4 | 1 | Chat presentation, sessions, billing states, and Choreograph |
| CONC-L12 | P2 | audit-required | 2 | 0 | Emporium and target-native product extensions |

## Work packages

| Work package | Wave | Priority | Status | Owner | Findings |
|---|---:|---:|---|---|---|
| CONC-WP-PRESENCE | 1 | P0 | in-progress | editor_host_stability | CONC-001, FID-004, FID-008 |
| CONC-WP-DUAL-PANE | 1 | P0 | proof-candidate | root | CONC-002, FID-002 |
| CONC-WP-LEFT-TOPOLOGY | 1 | P0 | proof-candidate | root | CONC-003 |
| CONC-WP-FILE-PANE | 1 | P0 | proof-candidate | root | CONC-004 |
| CONC-WP-ACCEPTANCE-SPINE | 1 | P0 | in-progress | root | FID-005, FID-006, FID-009 |
| CONC-WP-WORKSPACE-SELECTOR | 1 | P1 | proof-candidate | mobile_home_parity | CONC-005 |
| CONC-WP-EDITOR-SEMANTICS | 1 | P0 | in-progress | root | CONC-011, CONC-013 |
| CONC-WP-EDITOR-OVERLAYS | 1 | P0 | in-progress | root | CONC-012, CONC-014 |

## Dispatchable now

- None

## Completion rule

The campaign is not complete while any applicable finding is not `proven` or `intentional-departure`, any source surface is unclassified, or any capability lacks tier-appropriate evidence.
