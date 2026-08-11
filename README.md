# JSON Data Drift Analyzer

[![CI](https://github.com/SophanaSok/json-data-drift-analyzer/actions/workflows/deploy.yml/badge.svg)](https://github.com/SophanaSok/json-data-drift-analyzer/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Browser-first QA tool for scraped-data pipeline exports. Upload a known-good **baseline** JSON export and a suspect **latest** export of the same source; the analyzer diffs them record by record, surfaces drift and data-quality regressions, safely recovers what policy allows, and produces audit-ready reports — including a ready-to-post contractor ticket.

**Live app:** <https://sophanasok.github.io/json-data-drift-analyzer/>

Everything runs in your browser. No backend, no upload, no telemetry — see [Privacy model](#privacy-model).

## Why

Scraper pipelines fail quietly: a changed page layout empties a field across every record, a source hiccup drops records while gaining others, or duplicate entries slip in. Eyeballing two multi-megabyte JSON exports won't catch that. This tool turns "something looks off about this run" into a precise, evidenced answer: *which* fields regressed, *which* records were dropped, whether the loss is systemic (a broken extraction routine) or scattered, what can be safely recovered from the baseline, and what needs to go back to the scraper's maintainer.

## Features

- **Drift analysis** — per-record deep diff (added / removed / modified / emptied / restored fields), document-list comparison by hash, field fill-rate statistics, and a quality gate (`Pass` / `Warning` / `Quarantined`) with a deterministic plain-language incident narrative.
- **Recovery review** — a profile-driven pipeline (**match → QA → recover → dedupe**) that builds a *new* recovered artifact: it backfills only policy-approved fields where the candidate value is strictly blank and exactly one baseline match exists. Source JSON is never mutated.
- **Findings, not verdicts** — QA emits structured findings (severity, category, evidence, recommended action) across ten categories, including per-record dropped-record reports and dataset-level **systemic field loss** (a field lost in 100% of matched records — the signature of a broken selector).
- **Human decision queue** — every reviewable cell is classified `auto` (policy applied it), `review` (a person must decide), or `ineligible`. Decisions (use reference / keep candidate / custom value) require a reason and land in an append-only log. Bulk decisions show their impact — including how many populated values would be overwritten — before you confirm.
- **Full provenance** — every value in the recovered artifact is traceable: candidate-sourced, reference backfill, or manual override, with rule ID, actor, reason, profile version, and input-file hashes.
- **Five export artifacts** — recovered data, quality report, field-level recovery audit, findings CSV, and a Markdown contractor ticket. Only the recovered *data* is gated (blocked on low match rate or critical findings); reports and audits always export.
- **Optional Trello handoff** — post the contractor ticket as a Trello card with your own API key/token (token is never persisted), guarded by an arm-then-confirm flow and a run fingerprint that blocks duplicate posts.
- **Built for large exports** — analysis runs once in a Web Worker, results are cached in IndexedDB keyed by file content + configuration, and every large table (records, field changes, findings, decision queue) is virtualized. Search uses a prebuilt MiniSearch index.

## How it works

```
Baseline JSON ─┐
               ├─► Web Worker: parse (BOM-safe) ─► drift analysis (diff, stats,
Latest JSON  ──┘        quality issues, search index, narrative)
                        └─► recovery review: match → QA → recover → dedupe
                                 │
        IndexedDB cache ◄────────┤ (keyed by file hashes + config + profile
                                 │  + schema version)
                                 ▼
   Results UI: Overview · Records · Field Changes · Data Health · Recovery · Ticket
```

- **Matching** is exact and deterministic: primary key first, then fallback keys over the remainder. Ambiguity is judged against the whole reference population, so a fallback key can never silently pick the wrong record.
- **QA reports, never acts.** Recovery acts only where the source profile explicitly permits, and automation may never overwrite a non-blank value — only a person can, with a mandatory reason.
- **Dedupe** runs strictly after recovery, groups by exact normalized dedupe key, and accounts for every record (retained / removed / carried-excluded). Unkeyable records are never removed.

### Input format

Each file is a JSON export: a root object containing an array of record objects (default collection path `Export`; use `$` for a root-level array). A UTF-8 BOM is tolerated. Export dates are read from root-level `Refreshed` / `Created` fields (or a metadata object, or the first record) to verify the baseline really is older than the latest — reversed files trigger a warning and a blocking confirmation.

### Source profiles

A **source profile** (`src/profiles/*.json`) is the per-source policy: matching keys, dedupe key, hard-required fields, which fields may be auto-backfilled, date-sensitive fields (backfillable only when explicitly double-approved), minimum match rate, validation rules, and export gating. The profile's `version` is stamped into every finding, provenance entry, decision, and ticket; bumping it invalidates the analysis cache and flags decisions made under the older policy. There is currently no in-app profile editor — approving a new backfill field means editing the JSON and bumping `version`.

## Privacy model

All parsing, analysis, and recovery happen in-browser (in a Web Worker). Results, decisions, and Trello attempt records persist only in **local IndexedDB**. There is no backend, no authentication, no telemetry, and no file ever leaves your machine.

The single deliberate exception: the optional Trello integration posts the ticket **title and description only** to `api.trello.com`, after an explicit confirmation. Your Trello token is held in memory for the session and never persisted; the build-time Content Security Policy restricts network access to `'self'` and `https://api.trello.com`. Every export artifact passes a secret scan (`assertNoSecrets`) before it is handed to you.

Note: input-file SHA-256 hashes require a secure context (HTTPS). Over plain HTTP the app says so explicitly — "this run cannot prove which files it read" — rather than hiding it.

## Getting started

Requires **Node.js ≥ 20.19** (CI runs Node 20).

```bash
npm install
npm run dev        # http://localhost:4173/json-data-drift-analyzer/
```

Note the base path — the app serves under `/json-data-drift-analyzer/`, matching its GitHub Pages URL.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) + production build |
| `npm run preview` | Serve the built `dist/` |
| `npm test` | Vitest unit + component tests (run once) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | oxlint |

### Testing

- **Unit/component:** Vitest + Testing Library (jsdom), 30+ test files covering the engine and UI. `src/engine/analysis-scale.test.ts` pins worker-result size and guards against quadratic blowups at 8,000-record scale.
- **End-to-end:** Playwright with two projects — `dev` runs the spec suite against the dev server, while `built` runs `csp.spec.ts` against a production build, because the CSP is injected at build time only. First run: `npx playwright install chromium`.

### Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`: lint → typecheck → unit tests → build → Playwright e2e, then (on `main` only) the built `dist/` is published to the `gh-pages` branch via `peaceiris/actions-gh-pages`. Every PR runs the same test job.

## Project structure

```
src/
├── app/          # router, root layout, providers
├── components/   # results shell (tab layout), shared UI, records tables
├── db/           # Dexie/IndexedDB schema: analysis cache, decision log,
│                 # Trello attempts (versioned cache key)
├── engine/       # framework-agnostic core: diff, matching, QA, recovery,
│                 # dedupe, decisions, provenance, exports, ticket template
├── features/     # upload, overview, records, field-changes, data-health,
│                 # recovery review, contractor ticket, trello
├── lib/          # Trello client, safe storage, misc helpers
├── profiles/     # source profiles (per-source recovery policy)
├── stores/       # zustand UI state
├── test/         # fixtures (incl. real-world reference/candidate exports)
└── workers/      # analysis worker + message protocol
e2e/              # Playwright specs (smoke, recovery review, CSP)
docs/             # forensic case study + design proposals
```

Built with React 19, TypeScript (strict), Vite, Tailwind CSS, Zustand, Dexie, MiniSearch, TanStack Virtual, Vitest, and Playwright. `AGENTS.md` is the binding contributor contract.

## Limitations

- One source profile ships today (`bellingham-procureware`); adding a source means writing a profile JSON.
- Systemic field loss is flagged only at exactly 100% loss — partial thresholds are deliberately not invented.
- Dropped baseline records are reported per record but never reinstated into the recovered artifact.
- The recovered artifact is a stopgap for triage: the primary remedy for systemic loss is fixing and re-running the scraper.
- No clickjacking protection (`frame-ancestors` cannot be set via meta tag on GitHub Pages).

## License

[MIT](LICENSE) © 2026 SophanaSok
