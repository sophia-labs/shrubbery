# history — dated worklogs, kept for provenance

These are **frozen** worklogs from shrubbery's construction: per-iteration
records, spike notes, port handoffs, and shrubberyification summaries written as
the work happened. They are kept for provenance — *what was done, when, and why
it was decided that way* — not as living documentation. Nothing here is
maintained: treat every claim as true-as-of-its-date. For the current shape of
the repo see the root [`README.md`](../../README.md) and
[`ARCHITECTURE.md`](../../ARCHITECTURE.md); for live per-slice docs see the
sibling `docs/*` directories (`docs/planter/`, `docs/acceptance/`, etc.).

They were moved here (from the repo root) in a single sweep — the root had
accreted ~8 ephemeral logs that read as authoritative but were not. Git history
is preserved across the move (`git mv`).

## The iteration line (the pure core → Emporium)

| File | What it records |
|---|---|
| `ITERATION-LOG.md` | The running top-level log across iterations 0–3. |
| `ITERATION-1-LOG.md` | Iteration 1 — render host + chrome + the organism playground. |
| `ITERATION-2-LOG.md` | Iteration 2 — real `gardend` live-read over the cell proxy. |
| `ITERATION-3-LOG.md` | Iteration 3 — design-token system + Garden/Emporium skins + Storybook. |
| `CURL-CATALOG-SPIKE.md` | The curl-catalog spike (B0+B1) — birth of `@shrubbery/render` and the conneg server (curl/turtle/JSON-LD faces). |
| `ITERATION-4-LOG.md` | Iteration 4 — the live vocab catalogue + general primitives lifted from garden. |
| `ITERATION-5-LOG.md` | Iteration 5 — deepened pack-detail to full golden-contract anatomy. |
| `ITERATION-6-LOG.md` | Iteration 6 — `apps/emporium` as a dedicated product shell + the anatomy graph view. |

## The Greenhouse / SRS / Garden-port line

| File | What it records |
|---|---|
| `GREENHOUSE-V0-CENSUS.md` | Census of record for the Greenhouse v0 surface (the pre-shrubbery inventory). |
| `SLICE-1-IDENTITY-STRIP-LOG.md` | Greenhouse skin, slice 1 — the identity strip. |
| `GREENHOUSE_SHRUBBERYIFICATION_SUMMARY.md` | The Greenhouse/SRS shrubberyification worklog. |
| `SRS_SHRUBBERYIFICATION_SUMMARY.md` | The SRS (research workspace) shrubberyification summary. |
| `SHRUBBERY_GARDEN_PORT_HANDOFF.md` | WIP handoff for the Garden-frontend → shrubbery port. |

> Note on the two "Greenhouse" names: these logs predate the disambiguation now
> stated in the root README. Historically "Greenhouse" named the SRS/Vehicle
> cockpit line (now `apps/vehicle`); the current `apps/greenhouse` is the later
> "Greenhouse v1" live-only Choreograph workbench. Read the dates accordingly.
