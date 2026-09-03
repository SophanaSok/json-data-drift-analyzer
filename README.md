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
- **Findings, not verdicts** — QA emits structured findings (severity, category, evidence, recommended action) across thirteen categories, including a baseline-aware mirror of the pipeline's duplicate-titles alert, per-record dropped-record reports and dataset-level **systemic field loss** (a field lost in 100% of matched records — the signature of a broken selector).
- **Alert triage** — the pipeline holds a batch when several records share a title, and most of those holds are the recurring annual solicitations the last good run had too. Overview answers that in one line ("all 6 groups are also in the reference run — nothing new in this run"), Data Health lists the groups with their reference counts, and one button copies a note naming both runs, the policy version, and the build for pasting back into the pipeline. Releasing a hold stays a manual action there.
- **Ingestion-share proxies** — the pipeline's other alert fires when an unusual share of a batch reaches preclassification, and the export marks no such record, so Data Health says so plainly and shows proxies instead: the shape of the data ingestion reads, this run against the reference. Missing text, categorical distributions with a "(no value)" row, and document JSON validity, over the fields each profile already names. No threshold is applied, because none has been established.
- **Data Health** — both engines' signals in one severity order: the drift engine's quality issues beside the QA findings rolled up per category with exact counts, filterable by severity and text, each row linking to the field in Explore or to the view that can act on it.
- **Human decision queue** — every reviewable cell is classified `auto` (policy applied it), `review` (a person must decide), or `ineligible`. Decisions (use reference / keep candidate / custom value) require a reason and land in an append-only log. Bulk decisions show their impact — including how many populated values would be overwritten — before you confirm.
- **Full provenance** — every value in the recovered artifact is traceable: candidate-sourced, reference backfill, or manual override, with rule ID, actor, reason, profile version, and input-file hashes.
- **Six export artifacts, or one zip** — recovered data, quality report, field-level recovery audit, findings CSV, a Markdown contractor ticket, and a delivery manifest listing every file's SHA-256 with the app build, policy hash, and decision count. "Download bundle (.zip)" hands all of them back as one file. Only the recovered *data* is gated (blocked on low match rate or critical findings); reports, audits, and the manifest always export.
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
   Results UI: Overview · Records · Field Changes · Explore · Data Health · Recovery · Ticket
```

- **Matching** is exact and deterministic: primary key first, then fallback keys over the remainder. Ambiguity is judged against the whole reference population, so a fallback key can never silently pick the wrong record.
- **QA reports, never acts.** Recovery acts only where the source profile explicitly permits, and automation may never overwrite a non-blank value — only a person can, with a mandatory reason.
- **Dedupe** runs strictly after recovery, groups by exact normalized dedupe key, and accounts for every record (retained / removed / carried-excluded). Unkeyable records are never removed.

### Input format

Each file is a JSON export: a root object containing an array of record objects (default collection path `Export`; use `$` for a root-level array). A UTF-8 BOM is tolerated. Export dates are read from root-level `Refreshed` / `Created` fields (or a metadata object, or the first record) to verify the baseline really is older than the latest — reversed files trigger a warning and a blocking confirmation.

### Source profiles

A **source profile** is the per-source policy: matching keys, dedupe key, hard-required fields, which fields may be auto-backfilled, date-sensitive fields (backfillable only when explicitly double-approved), minimum match rate, validation rules, quality-analysis configuration, and export gating.

Profiles resolve in layers, built for hundreds of sources sharing one schema:

- **`src/profiles/base.json`** holds the policy the sources share; **`src/profiles/sources/<id>.json`** holds one small delta per source (auto-registered — adding a file is adding a source). A delta key replaces the base value wholesale; a delta MUST state `id`, `sourceUrl`, `version`, and `safeBackfillFields` explicitly (even `[]`) — backfill approval never inherits. Scaffold a new source with `npm run new-profile -- --id <id> --source-url <url>`.
- **Local overrides** (the *Profiles* page in the app) amend a source's policy in this browser only, without a release: edit the field lists or import a delta JSON, give a required reason, and export the result for upstreaming into the repo delta. An override written against an older repo version is flagged stale and not applied.
- The **resolved policy identity** — repo `version`, override revision, and a `policyHash` over the full resolved content — is stamped into every finding, provenance entry, decision, export, and ticket; any policy change invalidates the analysis cache and flags decisions made under the older policy. `src/profiles/policy-manifest.json` pins every profile's identity in CI: a policy edit fails the tests until `npm run profiles:manifest` is run deliberately, and that tool refuses a content change without a version bump.

On the upload page, profiles are chosen through a searchable picker, and the right one is suggested automatically by matching URL values inside the uploaded records against each profile's `sourceUrl` — a manual selection is never silently replaced.

## Privacy model

All parsing, analysis, and recovery happen in-browser (in a Web Worker). Results, decisions, and Trello attempt records persist only in **local IndexedDB**. There is no backend, no authentication, no telemetry, and no file ever leaves your machine.

The single deliberate exception: the optional Trello integration posts the ticket **title and description only** to `api.trello.com`, after an explicit confirmation. Your Trello token is held in memory for the session and never persisted; the build-time Content Security Policy restricts network access to `'self'` and `https://api.trello.com`. Every export artifact passes a secret scan (`assertNoSecrets`) before it is handed to you.

Note: input-file SHA-256 hashes require a secure context (HTTPS). Over plain HTTP the app says so explicitly — "this run cannot prove which files it read" — rather than hiding it.

## Getting started

Requires **Node.js ≥ 20.19** (CI runs Node 20).

```bash
npm install
npm run dev        # http://localhost:5173/json-data-drift-analyzer/
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
| `npm run analyze` | Headless analysis: full pipeline + artifacts from the command line (below) |

### Headless analysis and the suggested QC routine

Detection does not need the browser. `npm run analyze` runs the exact worker
pipeline (parse → drift analysis → recovery review → export bundle, with no
decisions applied) and exits non-zero when quality fails, so it can run per
export drop from a scheduler or CI job and page a human only when something is
wrong:

```bash
npm run analyze -- --baseline reference.json --latest new-export.json --out runs/2026-08-15
# exit 0: clean · exit 1: quality gate failed (details printed) · exit 2: usage error
```

The source profile is auto-detected from the file contents (pass `--profile
<id>` to pin it); browser-local profile overrides are not applied — a headless
run always uses the committed repo policy. Note the TypeScript CLI tools
(`analyze`, `new-profile`, `profiles:manifest`) need **Node ≥ 22.18** (built-in
type stripping); the app's build/test toolchain itself runs on Node 20. Every artifact (recovered JSON,
quality report, recovery audit, findings CSV, contractor ticket, delivery manifest) is written to
`--out` on every run.

The routine this enables — detection in the pipeline, review in the UI:

1. **Every new export**: run `npm run analyze` against the last known-good
   reference, writing artifacts into a dated folder you keep (a repo, a share —
   the artifacts are the durable audit record, not the browser's local state).
2. **On a non-zero exit**: open the browser UI, upload the same pair, and work
   the review — Explore/Recovery record decisions with reasons.
3. **After deciding**: export the artifacts again from the Recovery tab (now
   with decisions applied) and archive them next to the automated run's set.

### Testing

- **Unit/component:** Vitest + Testing Library (jsdom), 30+ test files covering the engine and UI. `src/engine/analysis-scale.test.ts` pins worker-result size and guards against quadratic blowups at 8,000-record scale.
- **End-to-end:** Playwright with two projects — `dev` runs the spec suite against the dev server, while `built` runs `csp.spec.ts` against a production build, because the CSP is injected at build time only. First run: `npx playwright install chromium`.

### Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`: lint → typecheck → unit tests → build → Playwright e2e, then (on `main` only) the built `dist/` is published to the `gh-pages` branch via `peaceiris/actions-gh-pages`. Every PR runs the same test job.

### Versioning and releases

The project follows semantic versioning against the user-facing contract (what
analysis results mean, the shape of exported artifacts, the recovery policy
model) — see the criteria at the top of [CHANGELOG.md](CHANGELOG.md). The
deployed footer shows `v<version> · Build <commit>`, and exported artifacts
carry both in their metadata, so any report can be tied to a release and an
exact build.

To cut a release:

1. In the PR that completes the release, bump `version` in `package.json` and
   move the `Unreleased` notes in `CHANGELOG.md` under the new version heading
   (create an `Unreleased` section as notable changes land, so this step is a
   rename, not an archaeology dig).
2. After the PR merges and `main` deploys green, tag and publish:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag
   ```

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
├── profiles/     # base.json + sources/*.json deltas, registry, resolver,
│                 # validator, detection, policy manifest
├── stores/       # zustand UI state
├── test/         # fixtures (incl. real-world reference/candidate exports)
└── workers/      # analysis worker + message protocol
e2e/              # Playwright specs (smoke, recovery review, CSP)
docs/             # forensic case study + design proposals
```

Built with React 19, TypeScript (strict), Vite, Tailwind CSS, Zustand, Dexie, MiniSearch, TanStack Virtual, Vitest, and Playwright. `AGENTS.md` is the binding contributor contract.

## Limitations

- Thirteen source profiles ship; only `bellingham-procureware` has any backfill approvals. The other twelve are v1 and UNAPPROVED: they detect their source, match and dedupe on keys measured from real exports, and report — they backfill nothing until a per-source approval lands. Onboarding another source means scaffolding a delta (`npm run new-profile`) and verifying its keys against real exports before first use.
- Systemic field loss is flagged only at exactly 100% loss — partial thresholds are deliberately not invented.
- Dropped baseline records are reported per record but never reinstated into the recovered artifact.
- The recovered artifact is a stopgap for triage: the primary remedy for systemic loss is fixing and re-running the scraper.
- No clickjacking protection (`frame-ancestors` cannot be set via meta tag on GitHub Pages).

## License

[MIT](LICENSE) © 2026 SophanaSok
