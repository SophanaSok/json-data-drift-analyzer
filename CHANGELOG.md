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

[1.1.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.1.0
[1.0.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.0.0
[0.1.0]: https://github.com/SophanaSok/json-data-drift-analyzer/commits/main
