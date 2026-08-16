# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/). For a browser tool
with no public API, the contract the version tracks is what a *user* relies on:
the meaning of analysis results, the shape of exported artifacts, and the
recovery policy model.

- **Major** — exported artifacts or analysis semantics change incompatibly
  (a report produced by the old version would be read differently by the new).
- **Minor** — new capability: a new analysis, view, export, or profile feature.
- **Patch** — fixes and internal improvements that do not change what results mean.

Each release is tagged `vX.Y.Z` on `main`. The deployed footer shows the version
and the exact build commit; exported artifacts carry both in their metadata.

## [1.6.0] — 2026-08-16

### Added

- **Headless analysis (`npm run analyze`).** The exact worker pipeline — parse,
  drift analysis, recovery review, export bundle with no decisions applied —
  runnable from the command line. Auto-detects the source profile from file
  contents (`--profile` to pin), writes every artifact to `--out` on every run,
  and exits non-zero on a quality failure so a scheduler or CI job can run
  checks per export drop and page a human only when something is wrong.
  Browser-local profile overrides are deliberately not applied. Core in
  `src/headless/run.ts` (tested); shell in `tools/analyze.ts`.
- **Format validation is live for Bellingham (profile v7).** The QA engine's
  configured validation (`field_validation_failure` findings) now has an
  evidence-backed `validation` block in the Bellingham delta: URL, JSON,
  email, phone, and date formats across 13 fields, verified against both
  shipped fixtures with zero false positives. Report-only — validation never
  backfills and rule 6 is untouched.
- **Schema-drift findings.** Two new QA categories complete the shape-drift
  story: `schema_field_added` (a field appears in the candidate schema that no
  reference record has) and `field_type_change` (a field's dominant non-empty
  value type differs between runs — drift that fill-rate analysis cannot see).
  Both flow into the findings CSV, ticket labels, and UI filters like any
  other category.
- **Suggested QC routine documented** in the README: automated `npm run
  analyze` per export drop with archived artifacts as the durable audit
  record; the browser UI for the decide-and-recover work.
- **Decision-log export/import.** The Recovery tab exports the decision log
  as JSON and imports a colleague's file — accepted only when it verifiably
  describes the same review (profile, version, policy hash, and input files
  by SHA-256), with imported rows keeping their provenance and appending
  after the local log so re-import is idempotent.
- **No-known-source notice.** The upload page now says when detection matches
  no profile, naming the policy that will apply instead of staying silent.
- **Multi-profile detection coverage.** All four detection notices are
  component-tested against a synthetic registry, and a temporary e2e fixture
  profile exercises the ambiguous and cross-source paths end to end.
- **Automated accessibility scan.** An axe pass over every main screen runs
  in e2e (zero critical/serious violations); it surfaced and fixed ten real
  issues — low-contrast text in seven places, two unlabeled filter selects,
  and four keyboard-unreachable scroll regions.
- **Bundle-size budget in CI** (300 kB gzip; currently ~229 kB), `.nvmrc` /
  `engines` node pin, and a real page title + meta description.
- **Overview tiles are links** (middle-click and copy work; the quality-gate
  tile links to Recovery where the gate is explained), and the
  high-cardinality value panel counts populated records correctly past the
  distinct-tracking cap.

### Removed

- The dormant field-state classification cluster (`classifyFieldValue`,
  `analyzeBlankValue`, `FieldValueState`, `FieldState`): zero production
  callers, and the real format validation lives in the QA engine.

### Fixed

(From PR #75, merged 2026-08-15.)

- Search indexes both sides of a changed field, so a record whose text the
  candidate wiped stays findable by what it used to say.
- The contractor ticket counts each affected field once (systemic + per-record
  finding groups no longer double the title count and field list).
- Enter commits a typed custom value in the decision form, completing the
  keyboard-only flow.
- GitHub Pages deep links and hard refreshes boot the app (`404.html`
  app-shell fallback); unknown routes show a not-found page instead of the
  error boundary; the results tabs gained a `<main>` landmark; the
  invalid-JSON upload error names the offending file.

### Changed

- `ENGINE_SEMANTICS_VERSION` bumped twice (2 → 4): the search-index fix and
  the new finding categories both change stored results, so cached analyses
  rebuild.
- `npm run typecheck` now covers `tools/`.

## [1.5.0] — 2026-08-12

### Added

- **Profiles at fleet scale.** The single hand-registered source profile
  becomes a layered model built for hundreds of sources sharing one schema:
  a shared `base.json` plus one small auto-registered delta per source
  (`src/profiles/sources/<id>.json`), validated structurally (unknown keys
  rejected) and quarantined into a diagnostics list instead of crashing the
  app when malformed. Backfill approvals never inherit: every delta must state
  `safeBackfillFields` explicitly, even when empty.
- **Local profile overrides** on the new *Profiles* page: amend a source's
  policy in this browser without a release — edit field lists or import a
  delta JSON, with a required reason, a computed diff of what the override
  changes, JSON export for upstreaming, and reset. Saves are refused when the
  merged result contradicts itself, and an override written against an older
  repo version is flagged stale and not applied.
- **Searchable profile picker** with keyboard navigation, virtualized for
  hundreds of sources; the last-used profile persists across sessions. The
  collection path and identity fields derive from the selected profile, with
  an explicit "edited — differs from profile" escape hatch.
- **Source auto-detection**: uploaded files are matched to a profile by the
  URL values inside their own records (per-profile data, defaulting from
  `sourceUrl` — zero extra configuration for most sources). A manual selection
  is never silently replaced; ambiguity and cross-source file pairs warn.
- **Policy identity**: every finding, provenance entry, decision, export, and
  Trello fingerprint now records `policyHash` (a hash of the full resolved
  policy) and the override revision alongside the profile version, and
  staleness checks refuse a same-version run whose resolved policy differs.
  `policy-manifest.json` pins every profile's identity in CI;
  `npm run profiles:manifest` refuses a policy change without a version bump.
- **Onboarding tooling**: `npm run new-profile -- --id <id> --source-url <url>`
  scaffolds an explicitly-unapproved delta with its keys stated visibly.

### Changed

- The Bellingham profile is restructured to v6 (base + delta; the hardcoded
  quality-analysis `defaultProfile` is absorbed into the profile as its
  `quality` section). No policy value changed, but decisions and cached
  analyses recorded under v5 correctly read as stale under the new policy
  identity, per the existing version discipline.
- The analysis worker now receives the fully resolved profile in the request
  instead of resolving policy by id itself; profile JSON left the worker
  bundle.

## [1.4.0] — 2026-08-12

### Added

- **Corroboration signal**: where a record's own surviving text still states a
  value that was lost, the tool compares it with the reference value a backfill
  would write and shows the quoted sentence. On the shipped pair this turns 499
  identical-looking DueDate decisions into a review list of 23 whose text
  disagrees, and marks 188 as agreeing. Record mode shows the evidence beside
  the reference value; field mode adds a Disagrees/Agrees filter.
- The signal **calibrates itself per field, per run**, and stays silent on
  fields the prose does not discuss — on this data PublishedDate and AwardDate
  agree about 2% of the time, so flagging them would be noise. Dates must be
  introduced by a deadline cue, which keeps a pre-bid meeting or a completion
  date from reading as a deadline disagreement.
- It is **advisory only** (AGENTS.md rule 5): it identifies review candidates
  and never decides, never changes a decision lane, and never modifies an
  artifact. It deliberately does not say which side is stale — an extended
  deadline leaves the old text behind, a stale reference leaves the new text
  behind — it shows the disagreement and the sentence.

### Changed

- The Bellingham source profile moves to v5, adding the text fields and
  deadline phrasing the signal reads, with the measured accuracy recorded in
  its notes.

### Fixed

- The record queue no longer measures its fixed-height rows dynamically, which
  had caused a synchronous flush mid-render when scrolling to a distant record.

## [1.3.0] — 2026-08-12

### Added

- **Record decisions work as a task queue**: one keystroke resolves a record
  and advances to the next one needing work. `a` accepts every pending
  reference value, `x` keeps the candidates, `1`–`9` select a field with
  `Enter`/`c`/`e` to accept, keep, or edit it, and `n`/`j`/`k` move through the
  queue. Focus stays in the workspace after every decision, and the last action
  is shown so stepping back is one key.
- **Focus mode** (`f`) hides the record list and run-level chrome so every
  pending decision fits on one screen — measured at 1280×720, all four fit
  without scrolling.
- **Manual value entry on any field** of a decidable record, not only the ones
  with something to accept: a field blank in both exports, or identical in
  both, can now be given a value, seeded from the current output and recorded
  as an audited decision with its reason. Profile-excluded fields stay locked.

### Changed

- The rule-6 approval is taken **once per source per session** rather than on
  every record, as `docs/recovery-workflow.proposed.md` §6.2 specifies. It is
  displayed while active and can be revoked at any time.

### Fixed

- Typed values are now **distinguishable from accepted reference values** in
  the exported recovery audit (`manual_custom_value` vs
  `manual_reference_accept` vs `manual_veto`); previously both were stamped
  identically, which the design had asked to avoid.
- An override targeting a profile-excluded field is refused by the engine, not
  only by the UI.
- Keyboard shortcuts no longer stop working while a checkbox has focus, and no
  longer intercept browser and OS chords such as Ctrl+J or Cmd+N.
- Editing the session reason now reaches the record already open.

## [1.2.0] — 2026-08-12

### Added

- **By record mode** on the Explore tab: a queue over every record with exact
  pending-decision counts, and a panel showing each field's candidate,
  reference, and **output** value — the record as the exported artifact will
  contain it, badged by source. Fields can be backfilled, kept, or edited in
  place (editing pre-fills the reference value for correction), and a whole
  record accepted at once.
- **Rule-6 acknowledgment**: a per-record accept-all covers date-sensitive
  fields only behind a confirmation that names the rule and each affected
  field, passed to the engine as an explicit acknowledged-fields list. Without
  it, multi-field bulk decisions keep skipping rule-6 cells as before.
- **Queue workflow**: previous/next/next-pending navigation with j/k/n
  keyboard shortcuts, progress over records with pending work, an only-pending
  filter, and a remembered session reason that pre-fills every decision form.
- Records absent from the recovery output warn inline before deciding, and the
  Records tab's detail view links into the mode.

## [1.1.0] — 2026-08-12

### Added

- **Explore tab** — a field-first view of both exports. Pick a field to see
  every record's candidate and reference value side by side, the distribution
  of reference values (distinct values grouped exactly, case variants kept
  separate), per-field evidence in the audit proposal's own terms (eligible
  count, conflicts, comparable pairs, "volatility unmeasurable from this run
  pair"), and the profile's policy for the field.
- **Backfill decisions in place**: per-row and bulk decisions from the Explore
  tab through the same append-only, reasoned decision log as the Recovery
  queue — with the decision lane and its reason now visible on every cell, and
  bulk scope named in words (field, situation, value group).
- **Vetoing an automatic backfill** is now a first-class action, and the veto
  reaches the exported artifact: keeping the candidate value on an
  auto-backfilled cell writes that value back, so the log and the artifact
  cannot disagree.
- Field Changes rows and Data Health issue fields deep-link into the Explore
  tab.

### Fixed

- Cells beyond the QA exemplar sampling cap (systemic fields over 500 records)
  are now decidable: the Explore tab classifies lanes per selected field from
  the records themselves rather than from the capped findings.

## [1.0.0] — 2026-08-12

First production release. The full production-readiness audit — three
correctness-critical engine findings, eight High, fifteen Medium, and all
Low-severity findings — is resolved, each fix with a proving test.

### Added

- Drift analysis of two JSON exports: field-level diffing with identity-based
  record matching (primary and fallback keys), document-level diffing of
  JSON-encoded list fields, per-field population statistics, and a
  deterministic incident narrative.
- Recovery review governed by versioned source profiles (`src/profiles/`):
  policy-gated automatic backfill, manual decision queue with an append-only,
  reasoned decision log, bulk decisions with impact preview, and forgery-proof
  record identity.
- Exports with full provenance: recovered dataset, quality/QA reports, decision
  audit, and CSV — every artifact stamped with profile version, rule ids, input
  hashes, app version, and build commit. A failed gate (match rate below the
  profile minimum, unresolved critical findings, or an empty collection)
  withholds the recovered artifact while reports remain available.
- Contractor ticket drafting with credential refusal, and Trello posting behind
  explicit confirmation with cross-run duplicate protection; only title and
  description ever leave the browser.
- Browser/local-first architecture: analysis in a worker, persistence in
  IndexedDB with a pruned cache, restore-on-refresh, a strict build-time CSP,
  and no telemetry.
- Keyboard-accessible triage: focusable table rows, columnheader `aria-sort`,
  modal focus management, and reliable live-region announcements.
- Engineering gates: 700+ unit tests plus Playwright journeys (including
  failure paths: malformed JSON, wrong collection path, blocked export, mocked
  Trello), coverage thresholds over a deterministic full-tree denominator,
  `noUncheckedIndexedAccess`, hardened oxlint, SHA-pinned CI actions, and a
  deploy pipeline that ships exactly the artifact the tests ran against.

## [0.1.0]

Initial development version, superseded by 1.0.0. Kept for reference: this is
the version every pre-release commit reported.

[1.4.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.4.0
[1.3.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.3.0
[1.2.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.2.0
[1.1.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.1.0
[1.0.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.0.0
[0.1.0]: https://github.com/SophanaSok/json-data-drift-analyzer/commits/main
