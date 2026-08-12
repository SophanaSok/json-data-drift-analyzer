# AGENTS.md

Operating rules for AI agents and contributors working in `json-data-drift-analyzer`.
These rules are binding. When a request conflicts with a rule, say so before acting.

> **Picking up work?** Read
> [PRODUCTION-READINESS-AUDIT.md](PRODUCTION-READINESS-AUDIT.md) first — its
> "Session handoff" section states what has been fixed, what is deliberately
> still open, and the environment setup this repo needs.

## Current product goal

Compare a bad candidate JSON export to a known-good reference export, identify
scraper regressions, produce an evidence-based contractor ticket draft, and
export a deduplicated usable JSON file with transparent provenance.

## Project rules

### 1. Never invent the data model
Never invent a source-data schema, field name, identity key, or business rule.
Inspect actual fixture JSON (`src/test/fixtures/`) and source code before making
claims. If a field or rule cannot be found in fixtures or code, say it is unknown
rather than assuming it.

### 2. Source JSON is immutable
Preserve uploaded/source JSON immutably. Recovered output must be a new artifact,
never an in-place mutation of a parsed source document.

### 3. Never overwrite non-empty values automatically
A non-empty candidate value is authoritative. Automatic processes may never
replace it. Conflicts are surfaced for human review only.

### 4. Backfill preconditions
Only backfill an approved field when **all** of the following hold:
- the candidate field is null, absent, empty, or whitespace-only;
- exactly one reference match exists;
- the field is explicitly permitted by that source profile.

If any condition fails, emit a review candidate instead of a backfill.

### 5. No fuzzy matching for automatic recovery
Automatic recovery uses exact, deterministic matching only. Fuzzy matching may
identify review candidates only and must never modify output.

### 6. Date-sensitive and value-sensitive fields need explicit approval
`DueDate`, `PublishedDate`, `AwardDate`, `BidStatus`, and `ContractValue` require
per-source explicit approval before automatic backfill. Absent that approval they
are review-only.

### 7. Everything is auditable
Every finding, recovery action, export, and Trello draft must record:
source run, reference run, matching key, rule/profile version, timestamp,
original value, output value, and reason. An action that cannot be explained by
its audit record must not ship.

### 8. Browser/local-first
The app remains browser/local-first. Do not introduce a backend, external upload,
telemetry, or authentication unless explicitly asked. All parsing and analysis
stays in-browser; persistence stays in local IndexedDB.

### 9. No committed secrets
Secrets must never be committed. Trello tokens must be user-entered locally or
provided through runtime environment/configuration.

### 10. Inspect before, validate after
Before editing: inspect the relevant code. After editing, run and report:
```bash
npm run typecheck
npm run test        # plus npm run test:e2e when UI behavior changed
npm run build
```
Report the changed files and the actual results, including failures.

### 11. Confirm before external effects
Do not make network writes, create Trello cards, or change external state without
a user-facing confirmation step in the UI.

## Repository grounding (verify before relying on it)

These are observations from the current tree, not a schema contract. Re-check
them rather than trusting this section.

- Export shape: root object with `Refreshed`, `Created`, and an `Export` array.
  The default collection path in the UI is `Export`; `$` selects a root array.
- Record fields present in current fixtures: `ProjectCode`, `Title`,
  `Description`, `BidStatus`, `BidType`, `BidURL`, `PublishedDate`, `DueDate`,
  `AwardDate`, `BidDocuments`, `BidDocumentHashes`.
- `src/engine/profile.ts` additionally references `AwardedVendorName`,
  `ResourceURL`, `AddendumDocuments`, `BidTabulations`, `AwardDocuments`, which
  do **not** appear in current fixtures. `ContractValue` (rule 6) is modeled in
  the Bellingham source profile as review-only; it is empty in 100% of records
  in both observed runs, so there is nothing to recover from it yet.
- Two profile concepts coexist. `defaultProfile` in `src/engine/profile.ts`
  (`QualityProfile`, `id: "default-government-bids"`, `version: 1`) drives
  quality/drift analysis. The per-source **profile registry** for recovery lives
  in `src/profiles/` (`PROFILES` / `getProfile` in `src/profiles/index.ts`);
  `src/profiles/*.json` is the single source of truth for what each source
  permits, including the rule 4 and rule 6 approvals. The one registered profile
  is `BELLINGHAM_PROCUREWARE` (`id: "bellingham-procureware"`, `version: 4` —
  bump the version on any change; its embedded notes record the approval
  history).
- Emptiness is defined by `isEmpty` in `src/engine/empty.ts` (null/undefined,
  whitespace-only strings, configured placeholders, empty arrays unless allowed).
  Reuse it; do not re-implement emptiness checks.
- Identity keys are built by `buildRecordKey` in `src/engine/identity.ts`.
  Reuse it for matching and deduplication.

## Layout

- `src/engine/` — framework-agnostic analysis (diff, quality, identity, profile,
  export metadata). Pure functions, unit-tested with Vitest.
- `src/workers/` — expensive analysis off the main thread.
- `src/features/` — route-level views. `src/components/` — shared UI.
- `src/db/` — Dexie/IndexedDB cache. `src/test/fixtures/` — sample exports.
- `e2e/` — Playwright specs.

New recovery, deduplication, export, and ticket-draft logic belongs in
`src/engine/` as pure, testable functions, with UI confined to `src/features/`.
