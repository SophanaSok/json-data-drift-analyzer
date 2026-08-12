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

[1.3.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.3.0
[1.2.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.2.0
[1.1.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.1.0
[1.0.0]: https://github.com/SophanaSok/json-data-drift-analyzer/releases/tag/v1.0.0
[0.1.0]: https://github.com/SophanaSok/json-data-drift-analyzer/commits/main
