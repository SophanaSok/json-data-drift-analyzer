# Proposal — user-controlled backfill policy and per-field recovery review

**Status: PROPOSAL. Not approved, not scheduled, no application code written.**
Design only. Parked for later pickup.

Governed by `AGENTS.md`. Evidence and field-level figures cited here come from
`docs/forensic-bellingham-report.md` and `src/profiles/bellingham-procureware.json`.

---

## 1. What this is for

Two capabilities, requested together:

1. Let the user decide **which fields are eligible for automatic backfill**, per source.
2. After analysis, let the user **choose which value lands in a specific field** of a specific
   record.

Both are feasible in the current architecture. The design hinges on treating them as two
genuinely different decisions, because `AGENTS.md` governs them differently.

### The motivating scale

The Bellingham comparison found ~2,900 lost field values across 499 records, in eight fields that
are 100% empty in the candidate export. Any workflow requiring a click per value is unusable at
that size, and any workflow that blanket-applies reference values violates rules 3, 5, and 6.
The design below has to survive both constraints at once.

---

## 2. The central distinction: policy vs. adjudication

| | **Policy** | **Adjudication** |
|---|---|---|
| Question | "Which fields may *ever* be auto-backfilled for this source?" | "For this record and field, which value do we use?" |
| Scope | Per source profile, all records | One (record, field) cell, or one bulk group |
| Who | User, once, deliberately | User, during review |
| Artifact | `safeBackfillFields` in the source profile | An entry in the decision log |
| Governing rule | Rule 4, third precondition | Rules 3, 5, 7 |

### Why the distinction unlocks the feature

Rules 3, 5, and 6 constrain **automatic** behavior:

- Rule 3 — "Never overwrite a non-empty candidate value **automatically**."
- Rule 5 — fuzzy matching "may identify review candidates only and must not modify output"
  (the rule heading is *"No fuzzy matching for automatic recovery"*).
- Rule 6 — date-sensitive fields require explicit approval "before **automatic** backfill."

A human explicitly selecting a value in a review UI is not an automatic process. So the review
lane can legitimately do things the auto lane must never do — overwrite a non-empty value, accept
a value surfaced by a fuzzy match — **provided** the audit record distinguishes who acted. This is
the difference between building the feature and building a bypass around the rules.

Consequence for the data model: every decision record carries `actor: "auto" | "user"`, and that
field is not optional.

---

## 3. Lane classification

Every (record, field) cell resolves to exactly one lane. Classification is a pure function of the
analysis result plus the active profile — no UI state, no side effects.

| Lane | Conditions (all must hold) | Behavior |
|---|---|---|
| **AUTO** | Field ∈ `profile.safeBackfillFields`; candidate value is null/absent/empty/whitespace-only; exactly one **exact** reference match | Pre-proposed with the reference value. Displayed, vetoable, fully audited. Never silently applied. |
| **REVIEW** | Any AUTO condition fails, but a reference value exists | Requires an explicit human choice. Never applied on its own. |
| **INELIGIBLE** | No reference value exists for the cell | Nothing offered. |

### Worked example — Bellingham, assuming `ContactPhone` and `ContactEmail` are permitted

| Cell | Lane | Why |
|---|---|---|
| `ContactPhone`, 171 blank records | AUTO | Permitted, blank, single exact match |
| `Title`, 499 blank records | REVIEW | Not permitted — absent from `safeBackfillFields` |
| `BidStatus`, 499 blank records | REVIEW | Rule 6 field, not permitted |
| `BidDocuments`, records `15B-2021` / `7B-2026` | REVIEW | Candidate value is `"[]"` — **non-blank**, so rule 3 bars the auto lane regardless of policy |
| `Description`, record `38B-2026` | REVIEW | Both sides non-empty and differing — a genuine content update, not a loss |
| `ContractValue`, all records | INELIGIBLE | Empty in both runs; nothing to offer |

The `BidDocuments` row is the important one: **rule 3 outranks policy.** A field being listed in
`safeBackfillFields` never makes a non-blank candidate value auto-overwritable. Lane
classification must check emptiness before it checks permission.

### Fuzzy matches

If fuzzy matching is ever added for match-candidate discovery, its results may only ever produce
REVIEW cells, flagged with the match score and method. There must be no code path from a fuzzy
match to the AUTO lane (rule 5).

---

## 4. Data model — an append-only decision log

Do not mutate records. Record decisions, and derive output from them.

```ts
type RecoveryDecision = {
  // identity
  matchKey: string;            // composite primary key value, e.g. "1431::https://…/afffb491-…"
  field: string;

  // the decision
  action: "backfill" | "keep-candidate" | "use-custom";
  originalValue: unknown;      // candidate value before the decision
  outputValue: unknown;        // value written to the artifact
  actor: "auto" | "user";
  reason: string;

  // provenance — AGENTS.md rule 7
  sourceRun: string;           // candidate run id / filename
  referenceRun: string;        // reference run id / filename
  matchingKey: string[];       // which key produced the pairing, e.g. ["AgentID","BidURL"]
  matchMethod: "exact" | "fallback-key" | "manual";
  profileId: string;
  profileVersion: number;
  timestamp: string;           // ISO-8601
};
```

This satisfies rule 7 by construction: source run, reference run, matching key, rule/profile
version, timestamp, original value, output value, and reason are all present on every entry, for
every action, whether taken by the auto lane or a person.

### Export is then a pure function

```ts
applyDecisions(
  candidateRecords: Array<Record<string, unknown>>,
  decisions: RecoveryDecision[],
  profile: SourceProfile
): { artifact: unknown; provenance: RecoveryDecision[]; skipped: … }
```

Properties this buys:

- **Rule 2 holds structurally.** The source array is an input; the artifact is a new value. There
  is no code path that writes back.
- **Reproducible.** Same inputs, same output. Testable in `src/engine/` with no UI.
- **Replayable.** When a fixed scraper run arrives, re-key the decision log against it to see
  which decisions are now moot, which still apply, and which conflict with freshly-scraped values.
  That matters here: recovery is a stopgap, and the log is what lets you retire it cleanly.
- **Auditable without reconstruction.** The provenance is the input to the export, not something
  inferred afterward.

---

## 5. Integration points in this repository

Verified against the tree as of this proposal. Nothing below has been changed.

| Location | Current state | Change needed |
|---|---|---|
| `src/engine/` | Pure, framework-agnostic, Vitest-covered | New modules: `recovery.ts` (lane classification), `decisions.ts` (log + apply), `export-artifact.ts` (serializer). All pure. |
| `src/engine/types.ts` | `QualityProfile` has `requiredFields`, `optionalEmptyFields`, `emptyRules`, `identityDefault`, `fieldGroups` — **no backfill concept at all** | **Partly done:** `SourceProfile` now exists in `src/engine/adapter-types.ts` with `id`, `version`, `collectionPath`, `primaryKey`, `fallbackKeys`, `dedupeKey`, `hardRequiredFields`, `safeBackfillFields`, `manualReviewFields`, `excludedFields`, `minimumMatchRate`. Still to decide: whether it replaces or composes with `QualityProfile` |
| `src/engine/source-loader.ts` | **Exists and is wired in.** BOM-safe parsing, profile-declared records-path resolution, rule-4 backfill gate, two named blankness policies. Used by `analysis.worker.ts` and `lib/file-order.ts` | — |
| `src/db/index.ts` | Dexie at `version(2)`. **`version(1)` declared a `profiles: "id"` store that `version(2)` dropped.** | `version(3)` re-adding `profiles`, plus a `decisions` table keyed by analysis + matchKey + field |
| `src/workers/protocol.ts` | `AnalyzeRequest` already accepts optional `profile?: QualityProfile` | Lane classification can ride the existing worker pass; add a `WorkerStep` for it |
| `src/engine/empty.ts` | `isEmpty` handles null/undefined, whitespace, placeholders, empty arrays | **Reuse as-is.** Note it treats `n/a`, `na`, `none`, `unknown`, `-` as empty; rule 4's precondition is strictly null/absent/empty/whitespace. Decide whether placeholder values count as "blank" for backfill eligibility — see §9. |
| `src/engine/identity.ts` | `buildRecordKey` joins identity fields with `::` | Reuse for `matchKey`. Composite keys are already supported. |
| `src/app/router.tsx` | Two routes: `/` (upload), `/results` | Add `/recover` |
| `src/stores/ui-store.ts` | zustand: `analysis`, `filter`, `selectedRecordId`, … | Add decision draft state; persist committed decisions to Dexie, not to the store |
| `src/features/` | `upload`, `overview`, `records`, `field-changes`, `data-health` | Add `profile-editor` and `recovery-review` |

The groundwork is better than it looks: `AnalysisResult` already carries `recordsById`,
`fieldStats`, and prebuilt `indexes`, which is most of what a review UI needs to filter and
virtualize. `@tanstack/react-virtual` is already a dependency and already used for the large
tables.

---

## 6. UI guardrails

These are requirements, not styling notes.

1. **Deny-by-default.** A new profile starts with `safeBackfillFields: []`. Nothing is permitted
   until explicitly enabled.
2. **Rule-6 fields need a separate gate.** `DueDate`, `PublishedDate`, `AwardDate`, `BidStatus`,
   `ContractValue` must not be enableable by the same control as other fields. Distinct
   confirmation, per source, with the rule stated in the dialog.
3. **Show the evidence at the moment of choosing.** When the user toggles a field, display its
   eligible count, conflict rate, and **comparable-pair count** from the current analysis.

   For Bellingham this would render, next to `ContactPhone`:
   `171 eligible · 0 comparable pairs · volatility unmeasurable from this run pair`

   That last figure is the point. All eight failed fields have **zero** records with a non-blank
   value on both sides, so no cross-run stability can be measured from this pair
   (forensic report §6a). A toggle without that number showing is a blind toggle.
4. **Lane is visible per cell.** The user should never have to infer why a cell is review-only.
   Show the reason: "candidate value is `[]` — non-blank (rule 3)".
5. **The auto lane still shows its work.** AUTO cells are pre-proposed, not pre-applied. The user
   sees every value before export and can veto individually or in bulk.
6. **Rule 11 applies at Trello, not at file export.** Writing a local file changes no external
   state. Creating a Trello card does, and needs its own confirmation step.

---

## 7. Bulk ergonomics — the part that makes it usable

With ~2,900 candidate values, bulk operation is the feature.

- **Field-level bulk apply** with preview and count: "apply reference value to all 242 blank
  `ContactEmail` records", showing what changes before it commits.
- **Group by identical value.** In the Bellingham reference, `ContactEmail`'s 243 populated values
  collapse to 4 distinct values (238 × `bids@cob.org`, 3 × `BIDS@COB.ORG`, 1 × `Bids@cob.org`,
  1 × `purchasing@cob.org`). `ContactPhone` collapses to 2, `BidType` to 5. One decision can cover
  238 records — but each still gets its own log entry, so provenance stays per-record.
- **Filter by lane**, reusing the existing `FilterState` mechanics.
- **Bulk veto** as a first-class action, not just bulk accept.

### The trap that grouping must not create

Bulk apply must copy **the matched reference record's own value**, never the modal value for the
field. The single `purchasing@cob.org` record proves why: a "fill with the common value" shortcut
would silently rewrite it with the wrong address. Group-by-value is a presentation affordance for
reviewing; the write path stays per-record.

Formatting normalization (`bids@cob.org` vs `BIDS@COB.ORG`, `(360) 778-7750` vs `360-778-7750`)
is a **separate, explicit** user decision. Recovery must not silently normalize.

---

## 8. Fidelity requirements for the export artifact

The Bellingham source has three properties a naive serializer will destroy:

1. **UTF-8 BOM.** Both source files begin with `U+FEFF` and fail `JSON.parse` unmodified. Whether
   the recovered artifact should carry a BOM is a decision, not a default. (Separately: this repo
   currently parses upload text directly at `src/workers/analysis.worker.ts:15-16` and
   `src/lib/file-order.ts:15-16` with no BOM handling, so **these real exports cannot be loaded by
   the app today.** That is a prerequisite bug for this feature, tracked in the forensic report,
   not fixed here.)
2. **Every value is a string.** No numbers, booleans, nulls, or nested structures anywhere in
   either file. A serializer that type-infers will change the artifact's shape.
3. **Document lists are JSON-encoded strings** — `"[]"`, or
   `"[{\"Title\":…,\"URL\":…,\"Hash\":…}]"`. Note the capitalized keys, which differ from the
   `BidDocument` type in `src/engine/types.ts` (`title`/`url`/`hash`). Decoding for display must
   not leak into the output encoding.

**Requirement:** a round-trip test — parse a source file, apply an empty decision set, serialize,
and assert byte-level equality with the input. If the identity case is not exact, no recovered
artifact can be trusted.

---

## 9. Open questions requiring your decision

1. ~~**Placeholder values and rule 4.**~~ **RESOLVED — placeholders are non-blank for backfill.**
   Two named policies now exist. `isBlankStrict` in `src/engine/empty.ts` implements rule 4's
   reading (null, absent, empty, whitespace-only); `isEmpty` keeps the broader reporting reading
   that also covers placeholders and empty arrays. `isBackfillEligibleValue` /
   `isBackfillEligibleField` in `src/engine/source-loader.ts` are the rule-4 gate and take **no
   policy argument**, so no call site can opt into placeholder semantics for backfill. A candidate
   `"N/A"` therefore routes to REVIEW rather than being overwritten. The asymmetry decided it:
   treating a placeholder as blank silently destroys a published value, while treating it as
   present only costs a human decision. Still theoretical for Bellingham — no placeholder values
   occur in either export.
2. **Profile scope.** One profile per source (`bellingham-procureware`), or per source + agent?
   `AgentID` is constant in this data, so the question is unforced today.
3. **Decision persistence lifetime.** Do decisions survive re-analysis of the same run pair? Of a
   *new* candidate run? Recommendation: persist keyed on (referenceRun, sourceRun); on a new run,
   surface prior decisions as suggestions requiring re-confirmation, never auto-replay them.
4. **Custom values.** Should `use-custom` (typing a value that appears in neither export) be
   allowed at all? It is the most auditable-but-dangerous option. Recommendation: allow, require a
   mandatory `reason` string, and mark it distinctly in the export provenance.
5. **Export format.** Recovered JSON only, or JSON + a sidecar provenance file? Recommendation:
   both, always, with the artifact naming itself as derived.

---

## 10. Suggested phasing

| Phase | Deliverable | Changes output? |
|---|---|---|
| **1** | Source profile type + editor UI + Dexie `version(3)` persistence. Policy only. | No |
| **2** | Lane classification engine + read-only review view. See what *would* happen. | **No** |
| **3** | Decision log, bulk actions, provenance-carrying export artifact | Yes — new artifact only |
| **4** | Trello ticket draft generated from the same decision records (rule 11 confirmation) | External |

Phase 2 carries most of the analytical value and changes nothing — it is the safest place to
stop and re-evaluate. A user could run phases 1–2 against Bellingham and get a precise,
evidence-backed answer to "what would recovery actually do?" without a single byte of output
being produced.

**Prerequisite before any phase:** BOM handling at the two parse sites, or the app cannot open the
files this feature exists to repair.

---

## 11. Explicitly not decided here

- Any UI layout, component structure, or visual design.
- Whether fuzzy matching gets built at all. This proposal only constrains it *if* it is
  (REVIEW lane only, never AUTO).
- The Trello draft's content or field mapping.
- Whether `safeBackfillFields` should ever be populated for the Bellingham source. That remains
  the open approval question in `src/profiles/bellingham-procureware.json`, and this proposal
  deliberately does not pre-answer it.
