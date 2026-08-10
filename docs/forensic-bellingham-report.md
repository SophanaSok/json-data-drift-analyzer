# Forensic comparison — Bellingham WA PW-02 (ProcureWare) exports

Read-only analysis. No application code, fixture data, or source JSON was modified.
Produced under the rules in `AGENTS.md`.

| | |
|---|---|
| **Reference (known-good)** | `lambda-20260714-194920-c3177c97_2026-07-15.json` (1,473,306 bytes) |
| **Candidate (suspected-bad)** | `lambda-20260715-080212-d3836a0d_2026-07-15.json` (1,403,286 bytes) |
| **Analysis date** | 2026-08-10 |
| **Method** | Deterministic exact-value comparison keyed on normalized `BidURL`. No fuzzy matching was used for any classification. |

### Filename discrepancy (fact)

The request named the candidate `lambda-20260715-080212-d3836a0d_2026-07-15-2.json`.
No file with a `-2` suffix exists in the repository root. The only file carrying run id
`d3836a0d` and timestamp `20260715-080212` is `lambda-20260715-080212-d3836a0d_2026-07-15.json`,
which is the file analyzed here. **Assumption requiring approval:** that this is the intended
candidate. If a distinct `-2` export exists elsewhere, this report must be re-run against it.

---

## 1. File shape and parse validity

### Facts

Both files fail `JSON.parse` as stored. Both begin with a UTF-8 BOM (`U+FEFF`, bytes `EF BB BF`)
before the opening `{`:

```
Unexpected token '', ""{"Export""... is not valid JSON
```

After stripping the BOM, both parse cleanly as valid JSON.

Top-level shape is identical in both files:

```
{ "Export": [ <bid record>, ... ] }
```

- Exactly one root key: `Export`. No wrapper metadata object, no root-level `Refreshed`/`Created`.
- **Path to individual bid records: `$.Export[*]`.**
- Reference: 500 records. Candidate: 500 records. All elements are plain JSON objects.
- Every record in both files carries the same 45 keys in the same order (1 distinct key-order
  signature per file). No record has extra or missing keys.
- Every value in every record is a JSON **string**. There are no numbers, booleans, nulls,
  nested objects, or nested arrays anywhere in either file. List-valued data
  (`BidDocuments`, `BidDocumentHashes`, `AddendumDocuments`, `AwardDocuments`, …) is stored as a
  **JSON-encoded string**, e.g. `"[]"` or `"[{\"Title\":\"…\",\"URL\":\"…\",\"Hash\":\"…\"}]"`.

### Consequences for this repository (fact)

- `src/workers/analysis.worker.ts:15-16` and `src/lib/file-order.ts:15-16` call `JSON.parse`
  directly on the uploaded file text with no BOM handling. **Both of these real exports would
  fail to load in the app today.** Reported only; no code changed.
- The engine's document logic (`src/engine/types.ts` `BidDocument`) models documents as objects
  with `title`/`url`/`hash`. This source encodes them as strings containing JSON with
  `Title`/`URL`/`Hash` (capitalized). A decode step is required before document-level diffing.
  Reported only; no code changed.
- The current default profile (`src/engine/profile.ts`) expects a root `Export` array — which
  matches — but its `identityDefault` of `["ProjectCode"]` is not the safest key here (see §3).

---

## 2. Field inventory

All 45 fields are present in 100% of records in **both** files, and all values are strings.
"Blank" below means `null`, absent, empty string, or whitespace-only — the strict definition in
`AGENTS.md` rule 4. (Note: `src/engine/empty.ts` additionally treats `n/a`, `na`, `none`,
`unknown`, `-` as empty; none of those placeholder values occur in either file, so the two
definitions agree on this data.)

### 2a. Fields with a real signal

| Field | Ref blank % | Cand blank % | Type | Representative reference value |
|---|---:|---:|---|---|
| `AgentName` | 0.0 | 0.0 | string | `"Bellingham WA - PW-02"` (1 distinct) |
| `AgentID` | 0.0 | 0.0 | string | `"1431"` (1 distinct) |
| `LegacyAgentID` | 0.0 | 0.0 | string | `"3042"` (1 distinct) |
| `ProjectCode` | 0.0 | 0.0 | string | `"34B-2026"` (500 distinct) |
| `Title` | **0.0** | **100.0** | string | `"Cordata Park Phase 2"` (466 distinct) |
| `Description` | 0.4 | 1.0 | string | `"The City of Bellingham solicits interest from…"` |
| `BidStatus` | **0.0** | **100.0** | string | `Awarded` 488, `Cancelled` 7, `Open for Bidding` 5 |
| `BidType` | **0.8** | **100.0** | string | `Invitation for Bid, Request a Quote` 231, `RFP` 121, `RFQ` 114, `SOQ` 29, `Sale of Surplus Property` 1 |
| `BidURL` | 0.0 | 0.0 | string | `"https://cob.procureware.com/Bids/afffb491-8c29-4c07-b1cf-826a13aae9af"` |
| `PublishedDate` | **0.0** | **100.0** | string | `"7/14/2026 8:30 AM"` (M/D/YYYY h:mm AM/PM) |
| `DueDate` | **0.0** | **100.0** | string | `"8/4/2026 11:00 AM"` |
| `AwardDate` | **2.4** | **100.0** | string | `"2/24/2021"` (M/D/YYYY, no time) |
| `ConferenceDescription` | 89.6 | 89.6 | string | `"Pre-Bid Meetings at Project Site…"` |
| `ContactPhone` | **65.6** | **100.0** | string | `"(360) 778-7750"` 131, `"360-778-7750"` 41 |
| `ContactEmail` | **51.4** | **100.0** | string | `"bids@cob.org"` 238, `"BIDS@COB.ORG"` 3, `"Bids@cob.org"` 1, `"purchasing@cob.org"` 1 |
| `ResourceURL` | 0.0 | 0.0 | string | `"https://cob.procureware.com/Bids"` (1 distinct) |
| `BidDocuments` | 0.0 | 0.0 | JSON-in-string | `"[]"` in 150/500; document arrays in 350/500 |
| `BidDocumentHashes` | 0.0 | 0.0 | JSON-in-string | `"[\"81A7C698D3DCA9C3845221A4B6ED9F44\"]"` |
| `AddendumDocuments` / `AddendumDocumentHashes` | 0.0 | 0.0 | JSON-in-string | `"[]"` in 496/500; 4 populated |
| `AwardDocuments` / `AwardDocumentHashes` | 0.0 | 0.0 | JSON-in-string | `"[]"` in 499/500; 1 populated |
| `Created` | 0.0 | 0.0 | string | ref `2026-07-14 21:48:33/34`; cand `2026-07-15 10:01:07/08/09` |
| `Refreshed` | 0.0 | 0.0 | string | identical to `Created` in every record of both files |

### 2b. Fields empty in 100% of records in **both** files (22)

`Addendum`, `AwardedVendorName`, `BidTabulations`, `BidTabulationHashes`, `ConferenceInfo`,
`ContactName`, `ContactTitle`, `ContactFax`, `ContractValue`, `Jurisdiction`, `Modified`,
`IssuingAgencyAddress1`, `IssuingAgencyAddress2`, `IssuingAgencyCity`, `IssuingAgencyState`,
`IssuingAgencyZip`, `UsingAgencyAddress1`, `UsingAgencyAddress2`, `UsingAgencyCity`,
`UsingAgencyState`, `UsingAgencyZip`.

**Fact:** these carry no data in either run, so they are not part of this regression. **They are
also not evidence that the source has no such data** — only that this export path never populates
them. Note that `ContractValue`, named in `AGENTS.md` rule 6, is one of these: it exists as a key
but has never held a value in either run.

---

## 3. Primary match key evaluation

### Facts — uniqueness measured over all 500 records in each file

| Candidate key | Ref unique | Ref blank | Ref dup groups | Cand unique | Cand blank | Cand dup groups |
|---|---:|---:|---:|---:|---:|---:|
| `BidURL` (raw) | 500 | 0 | 0 | 500 | 0 | 0 |
| `BidURL` (normalized) | 500 | 0 | 0 | 500 | 0 | 0 |
| `BidURL` GUID tail only | 500 | 0 | 0 | 500 | 0 | 0 |
| `ProjectCode` | 500 | 0 | 0 | 500 | 0 | 0 |
| `AgentID` | **1** | 0 | **1 group / 500 records** | **1** | 0 | **1 group / 500 records** |
| `LegacyAgentID` | **1** | 0 | **1 group / 500 records** | **1** | 0 | **1 group / 500 records** |
| `AgentID` + `ProjectCode` | 500 | 0 | 0 | 500 | 0 | 0 |
| `AgentID` + `BidURL` | 500 | 0 | 0 | 500 | 0 | 0 |
| `ProjectCode` + `BidURL` | 500 | 0 | 0 | 500 | 0 | 0 |

Additional facts:

- `AgentID` and `LegacyAgentID` are **constants** in this dataset (`"1431"`, `"3042"`) and
  collide across all 500 records. They cannot serve as a record key alone; they are agent/tenant
  discriminators only.
- All 1,000 `BidURL` values across both files match
  `^https://cob\.procureware\.com/Bids/<uuid-v4-shaped-hex>$` exactly. Zero trailing slashes,
  zero query strings, zero fragments, zero non-HTTPS, zero host variation, zero leading/trailing
  whitespace. **URL normalization is currently a no-op on this data** — it is defensive only.
- `ProjectCode` is 100% unique and non-blank in both files. 996/1000 match `\d+[A-Z]+-\d{4}`;
  the exceptions are `4INF-25` (2-digit year) and `48B-2025-Clone-Clone` (source-system clone
  artifact, see §8).
- **Cross-validation:** matching on normalized `BidURL` produced 499 shared pairs. In **499 of
  499** of those pairs the `ProjectCode` values also agree. Zero disagreements. The two keys
  independently produce the identical pairing.
- Array position is **not** a usable key: only 4 of 499 shared records occupy the same array
  index in both files; 495 shifted, maximum shift 488 positions.

### Recommendation (assumption requiring approval)

- **Primary key: `AgentID` + `BidURL` (normalized).** `BidURL` carries the ProcureWare GUID,
  which is the source system's own opaque identifier — it is the value least likely to be
  re-typed or re-issued. `AgentID` is prefixed so the key stays correct once exports from other
  agents are analyzed in the same tool.
- **Fallback key: `AgentID` + `ProjectCode`.** Proven equivalent on this data (499/499), useful
  if a future export changes URL structure. It is a fallback rather than the primary because
  `ProjectCode` is a human-facing code — the `-Clone-Clone` value proves it is mutable in the
  source system.
- **Rejected: `AgentID` alone, `LegacyAgentID` alone** — constant, 500-way collision.
- **Rejected: `Title`** — not evaluated as a key because it is 100% blank in the candidate and
  has 34 collisions in the reference (466 distinct titles over 500 records).

---

## 4. Record classification

Key: normalized `BidURL`. Exact string matching only.

| Class | Count | % of candidate |
|---|---:|---:|
| Shared (present in both) | **499** | 99.8% |
| Reference-only (dropped from candidate) | **1** | — |
| Candidate-only (new in candidate) | **1** | 0.2% |
| Shared records with ≥1 field non-blank in reference but blank in candidate | **499** | **100.0%** |
| Shared records with ≥1 conflicting non-empty value | **499** | **100.0%** |

**Match rate: 99.80%.**

### The two unmatched records (facts)

- **Reference-only — `3B-2018`** (`…/1f63cba2-ec3b-4c40-a874-1a03f4830ecf`), at reference array
  index 444. Fully populated in the reference: `Title`, `BidStatus: Awarded`, `BidType: RFP`,
  `PublishedDate 1/19/2018`, `DueDate 2/20/2018`, `AwardDate 3/13/2018`. It is the oldest-coded
  record in the file. Absent from the candidate.
- **Candidate-only — `33B-2026`** (`…/f4b32f06-8e1c-44d7-8931-175e6a226c19`), at candidate array
  index 50. Has `Description`, `BidDocuments` (5 docs), `BidDocumentHashes` — but `Title`,
  `BidStatus`, `BidType`, `PublishedDate`, `DueDate`, `AwardDate` are all `""`, exactly like every
  other candidate record.

### Conflicting non-empty values, broken out (facts)

The 100% conflict figure is dominated by run stamps. Broken out by cause:

| Cause | Field(s) | Records | Assessment |
|---|---|---:|---|
| Run timestamp — expected | `Created`, `Refreshed` | 499 each | **Benign.** Every record's stamp moved from the 2026-07-14 21:48 run to the 2026-07-15 10:01 run. Not a regression; these should be excluded from drift comparison. |
| Genuine source content update | `Description` (`38B-2026`) | 1 | **Benign.** 1,154-char common prefix, 303-char common suffix; the only change is `"July 29"` → `"August 4th"` in the text `"…no later than 11:00 AM on <date>"`. The source updated a due date in prose. This is proof the candidate run *did* fetch fresh content successfully. |
| Document list emptied | `BidDocuments`, `BidDocumentHashes` (`15B-2021`, `7B-2026`) | 2 each | **Regression.** Populated document arrays became `"[]"`. |

Excluding `Created`/`Refreshed`, only **3 shared records** have any conflicting non-empty value,
and only 2 of those are regressions.

---

## 5. Field regression quantification

Measured over the **499 shared records**. "Lost" = non-blank in reference, blank in candidate.

| Field | Lost | % of shared | Had value in ref | **% of populated values lost** |
|---|---:|---:|---:|---:|
| `Title` | 499 | 100.0% | 499 | **100%** |
| `BidStatus` | 499 | 100.0% | 499 | **100%** |
| `DueDate` | 499 | 100.0% | 499 | **100%** |
| `PublishedDate` | 499 | 100.0% | 499 | **100%** |
| `BidType` | 495 | 99.2% | 495 | **100%** |
| `AwardDate` | 487 | 97.6% | 487 | **100%** |
| `ContactEmail` | 242 | 48.5% | 242 | **100%** |
| `ContactPhone` | 171 | 34.3% | 171 | **100%** |
| `Description` | 3 | 0.6% | 497 | 0.6% |
| `BidDocuments` | 0 (2 emptied to `"[]"`) | 0.4% | 499 | 0.4% |
| `BidDocumentHashes` | 0 (2 emptied to `"[]"`) | 0.4% | 499 | 0.4% |
| all other fields | 0 | 0.0% | — | 0% |

**The decisive fact:** for the first eight fields, the loss rate against *populated* reference
values is exactly **100%**. Their differing "% of shared" figures are purely a function of how
often each field was populated in the reference — `AwardDate` shows 97.6% only because 12 records
(7 `Cancelled` + 5 `Open for Bidding`) never had an award date to begin with. Not one record in
the candidate retained a value in any of these eight fields.

Across the **entire** candidate file (all 500 records, not just shared), these eight fields hold
the value `""` — an empty string, never `null`, never whitespace, never absent — in **500/500**
records. The failure is total and uniform, not sampled or intermittent.

### Per-record loss distribution (shared records)

| Fields lost | Records |
|---:|---:|
| 5 | 11 |
| 6 | 224 |
| 7 | 118 |
| 8 | 145 |
| 9 | 1 |

Floor of 4 is guaranteed (`Title`, `BidStatus`, `DueDate`, `PublishedDate`); the variation above
that comes from whether the record also had `BidType`, `AwardDate`, `ContactEmail`, `ContactPhone`.

### Three "shell" records (fact)

`32B-2018`, `15B-2021`, `7B-2026` lost `Description` on top of the eight-field loss. Each retains
exactly 14 of 45 fields non-blank — only `AgentName`, `AgentID`, `LegacyAgentID`, `ProjectCode`,
`BidURL`, `ResourceURL`, the four document/hash pairs, `Created`, `Refreshed`. A typical candidate
record retains 15 (the same set plus `Description`). Two of these three (`15B-2021`, `7B-2026`)
are also the two records whose `BidDocuments` were emptied. These look like whole-record detail
fetch failures, distinct from the systematic field failure.

---

## 6. Recoverability assessment

Restating `AGENTS.md` rule 4: backfill is permitted only where the candidate value is blank,
exactly one reference match exists, and the field is explicitly permitted by the source profile.
The eligibility counts below satisfy the first two conditions. **The third is not satisfied for
any field** — no approved profile exists yet. These are proposals, not authorizations.

### 6a. The core obstacle: zero measurable evidence of value stability

Before any per-field judgement, one measurement governs the whole section. For each failed field,
how many record pairs carry a non-blank value on **both** sides? Those are the only observations
that could establish whether a field changes between runs.

| Field | Ref populated | Cand populated | Comparable pairs | Volatility measurable? |
|---|---:|---:|---:|---|
| `Title` | 500 | 0 | **0** | No |
| `BidStatus` | 500 | 0 | **0** | No |
| `DueDate` | 500 | 0 | **0** | No |
| `PublishedDate` | 500 | 0 | **0** | No |
| `BidType` | 496 | 0 | **0** | No |
| `AwardDate` | 488 | 0 | **0** | No |
| `ContactEmail` | 243 | 0 | **0** | No |
| `ContactPhone` | 172 | 0 | **0** | No |

Zero across the board, and the reason is circular: the same failure that makes these fields need
recovery also destroyed the only evidence that could justify recovering them. **Any claim that one
of these fields is "stable enough to backfill" is an assumption, not a finding** — including for
fields where intuition says stability is obvious. Note in particular that the zero-conflict counts
in the table below are not evidence of stability: there are no candidate values to conflict with.

Breaking the circularity requires **a second known-good run**. Two good runs would yield roughly
499 comparable pairs per field and answer the volatility question empirically. Until then,
`safeBackfillFields` stays empty by construction.

### 6b. Per-field eligibility and risk

| Field | Eligible records | Blocked (non-empty conflict) | Assessment |
|---|---:|---:|---|
| `ContactPhone` | 171 | 0 | **Lowest risk.** Only 2 distinct values across the entire reference (`(360) 778-7750`, `360-778-7750`) — static organizational contact data, not per-bid data. |
| `ContactEmail` | 242 | 0 | **Lowest risk.** 4 distinct values, 3 of which are case variants of `bids@cob.org`; 1 outlier `purchasing@cob.org`. Static organizational data. |
| `BidType` | 495 | 0 | **Low risk.** Closed 5-value taxonomy. A bid's type is set at solicitation and has no reason to change. Not directly rule-6-listed. |
| `Title` | 499 | 0 | **Low-to-moderate risk.** Descriptive and stable in principle, but **unmeasurable here**: the candidate has zero `Title` values, so this comparison cannot establish a title-change rate. Recommending it as "safe" would be an assumption, not a finding. |
| `AwardDate` | 487 | 0 | **Rule 6 — explicit approval required.** Also date-sensitive by nature. |
| `BidStatus` | 499 | 0 | **Rule 6 — explicit approval required.** Highest semantic risk of the set: status is precisely the field that legitimately changes between runs (`Open for Bidding` → `Awarded` → `Cancelled`). Backfilling yesterday's status would actively assert stale facts. |
| `DueDate` | 499 | 0 | **Rule 6 — explicit approval required.** `38B-2026` is direct evidence that due dates move: its prose description changed from July 29 to August 4th between these two runs. A `DueDate` backfilled from the reference would have been wrong for that record. |
| `PublishedDate` | 499 | 0 | **Rule 6 — explicit approval required.** Semantically immutable once published, but rule-6-listed. |
| `Description` | 3 | 1 | **Review only.** Only 3 candidates, and the single conflicting record proves descriptions are actively edited in the source. |
| `BidDocuments` / `BidDocumentHashes` | 0 | 2 | **Not eligible for backfill at all.** The candidate values are `"[]"` — a non-blank string. Rule 3 forbids overwriting it automatically. These 2 records are review-only. |
| `ContractValue` | 0 | 0 | Nothing to recover — empty in both runs. |

### 6c. Direct proof that a `DueDate` backfill would have written a wrong value

This is the single sharpest piece of evidence in the analysis. Record `38B-2026`:

| | |
|---|---|
| Reference `DueDate` | `"7/29/2026 11:00 AM"` |
| Reference `Description` | `"…no later than 11:00 AM on **July 29**, 2026"` |
| Candidate `DueDate` | `""` (lost to the regression) |
| Candidate `Description` | `"…no later than 11:00 AM on **August 4th**, 2026"` |

The candidate's *surviving* prose proves the deadline moved. A `DueDate` backfill from the
reference would have stamped **July 29** onto a live, open solicitation — publishing a deadline six
days earlier than the real one, to contractors deciding whether they still have time to bid. This
is not a hypothetical risk profile; the files contain the counter-evidence.

### 6d. Where the risk actually concentrates

Only **5 of 500** reference records had a `DueDate` in the future at reference run time
(2026-07-14 21:48). They are exactly the same 5 records carrying `BidStatus: "Open for Bidding"`:

| Project | Due | Published | Note |
|---|---|---|---|
| `32B-2026` | 7/15/2026 11:00 AM | 6/18/2026 | Candidate run was **2026-07-15 10:01** — deadline ~1 hour away |
| `39B-2026` | 7/21/2026 11:00 AM | 7/6/2026 | |
| `38B-2026` | 7/29/2026 11:00 AM | 7/9/2026 | **Known stale — actually moved to Aug 4 (§6c)** |
| `41B-2026` | 7/29/2026 11:00 AM | 7/14/2026 | |
| `34B-2026` | 8/4/2026 11:00 AM | 7/14/2026 | |

The other 495 records are `Awarded` (488) or `Cancelled` (7) — historically frozen, and genuinely
low-risk to backfill on the merits.

**The distribution is the point.** Aggregate backfill risk looks negligible at 1% of records, but
it lands **entirely on the only bids a contractor can still act on**. `32B-2026` is the starkest
case: backfilling `"Open for Bidding"` would assert an open solicitation whose deadline expired
within the hour of the candidate run. A risk metric averaged over all 500 records would score this
as safe and be exactly wrong.

### 6e. Why the contact fields are the safest — and the caveat that still applies

Contact-field presence in the reference is strongly year-correlated, not randomly distributed:

| Year | Records | `ContactEmail` % | `ContactPhone` % |
|---|---:|---:|---:|
| 2018 | 55 | 100% | 100% |
| 2019 | 67 | 100% | 100% |
| 2020 | 58 | 36% | 14% |
| 2021 | 46 | 37% | 20% |
| 2022 | 54 | 20% | 19% |
| 2023 | 69 | 12% | 17% |
| 2024 | 77 | 40% | 14% |
| 2025 | 52 | 38% | **0%** |
| 2026 | 21 | 57% | **0%** |

The source stopped publishing contact data consistently around 2020, and stopped publishing phone
numbers entirely from 2025. Because backfill only fires where the *reference* holds a value, the
eligible records cluster in 2018–2019 — long-closed, immutable procurements. That is a genuine,
data-grounded argument for low risk, and the reason these two rank first for promotion.

**Caveat — the values are not uniform, so backfill must copy per-record, never per-field.**

| `ContactEmail` | count | | `ContactPhone` | count |
|---|---:|---|---|---:|
| `bids@cob.org` | 238 | | `(360) 778-7750` | 131 |
| `BIDS@COB.ORG` | 3 | | `360-778-7750` | 41 |
| `Bids@cob.org` | 1 | | | |
| `purchasing@cob.org` | 1 | | | |

Any implementation that fills from a modal or default value would silently rewrite the single
`purchasing@cob.org` record with the wrong address. Backfill must take **the matched reference
record's own value**. A recovered export will therefore carry mixed casing and mixed phone
formatting; whether to normalize that is a separate decision for the operator, not something to
apply automatically.

### 6f. Why `Title` is not in the safe tier despite the best-looking numbers

`Title` has the highest eligible count (499) and zero conflicts — superficially the strongest
case in the table. Both figures are artifacts: the zero-conflict count exists only because the
candidate has no titles to conflict with (§6a), and the 499 eligible records simply restate the
totality of the failure. Titles are stable in principle, but "in principle" is reasoning, not
measurement. Being the single largest available recovery win (499 records, ~17% of all lost
values) is a reason for a deliberate decision, not a default one.

### Summary

- **Safest recovery candidates (still require your approval):** `ContactPhone`, `ContactEmail` —
  static organizational values with 2 and 4 distinct values respectively.
- **Defensible next tier (require your approval):** `BidType`, `Title`.
- **Do not auto-backfill:** `BidStatus`, `DueDate`, `AwardDate`, `PublishedDate` — rule-6-listed,
  and `BidStatus`/`DueDate` are demonstrably volatile in this very dataset.
- **Never eligible:** `BidDocuments`, `BidDocumentHashes` — non-blank in the candidate.

Because the eight failed fields are 100% empty in the candidate, backfilling all of them would
mean reconstructing roughly 2,900 field values from a single prior run. **The correct primary
remedy is re-running a fixed scraper, not recovery.** Recovery should be treated as a stopgap that
produces a clearly-labelled derived artifact, per rule 2.

---

## 7. Scraper issue hypothesis

### Evidence

1. Exactly eight fields fail: `Title`, `BidStatus`, `BidType`, `PublishedDate`, `DueDate`,
   `AwardDate`, `ContactEmail`, `ContactPhone`.
2. Failure is total and uniform — `""` in 500/500 records, including the newly-discovered
   `33B-2026`.
3. The failure value is consistently `""`, never `null` and never a missing key. The record
   schema, key set, and key order are byte-for-byte structurally identical to the reference.
4. Fields that **survive** intact: `Description` (495/500 populated), `ConferenceDescription`
   (same 10.4% populated rate as reference), `BidDocuments`/`BidDocumentHashes` (349 vs 350
   populated), `AddendumDocuments`, `AwardDocuments`, and all identity/routing fields.
5. `38B-2026`'s description shows a genuine content update between runs (July 29 → August 4th).
6. The candidate discovered a record the reference did not have (`33B-2026`), and that record's
   `Description` and 5 `BidDocuments` were fetched successfully.

### Hypothesis

**A single extraction routine that parses the bid header/summary block of the ProcureWare detail
page stopped matching its target, while the routines for the description block, conference block,
and document/attachment lists continued working.**

The reasoning: evidence 5 and 6 prove the crawler still authenticated, still enumerated the bid
list, still discovered new bids, still fetched individual detail pages, and still parsed several
distinct regions of those pages. Network failure, auth failure, and rate-limiting are all ruled
out — a blocked crawler cannot return 349 correct document arrays and a freshly-updated
description. Evidence 1–3 point to one localized parser: the failure is field-scoped rather than
record-scoped, absolute rather than probabilistic, and writes the routine's initialized default
(`""`) rather than propagating an error.

The affected set is also semantically coherent — title, status, type, three dates, and two contact
fields are exactly the attributes a ProcureWare bid detail page renders in its header/summary
panel, typically as a definition-list or label/value table. Notably this set is very close to the
`header-metadata` field group already defined in `src/engine/profile.ts`
(`Title`, `BidStatus`, `BidType`, `PublishedDate`, `DueDate`, `AwardDate`), which suggests the
grouping was derived from the same page structure.

The most probable proximate cause is a **markup change on the vendor side** — a renamed CSS class,
changed element nesting, or a switch to client-side rendering for that panel — that invalidated one
selector or one regex block, combined with error handling that swallows the miss and emits the
empty-string default instead of failing loudly.

**Confidence: high** that the fault is a single localized header/summary extraction routine.
**Confidence: moderate** on markup change as the specific trigger — that cannot be confirmed from
the JSON alone and requires inspecting the scraper source and a saved copy of the current page HTML.

### Explicitly *not* claimed

- Which selector, library, or code path failed. Not determinable from export data.
- Whether the trigger was a vendor markup change, a scraper deployment, or a dependency upgrade.
  Correlating the run timestamps (`2026-07-14 21:48` good → `2026-07-15 10:01` bad) with the
  scraper's deploy history would settle this.
- Whether the 3 shell records share the systematic cause. Their extra `Description` loss suggests a
  separate per-record fetch failure and should be investigated as a distinct issue.

### Secondary observation — the 500-record ceiling (lower confidence)

Both files contain **exactly** 500 records, and the candidate gained one record while dropping
one. A round 500 in both runs is consistent with a page-size or result cap. **However**, the
dropped record (`3B-2018`, oldest project code) sits at reference index 444, the gained record at
candidate index 50, and 495 of 499 shared records moved position — so array order is not a stable
recency ordering and the eviction cannot be confirmed as recency-based from this data. Worth
verifying against the scraper's pagination configuration; not established here.

---

## 8. Duplicate-record behavior and dedupe key

### Facts

- **Zero exact duplicates** on `BidURL`, on `ProjectCode`, or on any composite of the two, in
  either file. 500 unique values from 500 records, twice over.
- **`48B-2025-Clone-Clone`** exists in both files. The doubled `-Clone` suffix is a source-system
  artifact — a record cloned twice inside ProcureWare. No `48B-2025` or `48B-2025-Clone` sibling
  exists in either export.
- **28 groups of records share an identical `Title`** in the reference, covering **70 records**
  (466 distinct titles over 500 records).
- In **all 28 groups**, `BidURL` GUIDs are 100% distinct and `DueDate` values are 100% distinct.
- **27 of the 28 groups span multiple years.**
- Zero records share both `Title` and `DueDate`.

### 8a. What a `Title`-keyed dedupe would actually destroy

A dedupe keyed on `Title` would delete **42 of 500 reference records (8.4%)** as false duplicates.

The worst group — six separate procurements of the same water-treatment chemical, spanning eight
years, each with its own GUID, due date, and award cycle:

| "Aluminum Sulfate (Liquid)" | Due | Status |
|---|---|---|
| `35B-2018` | 5/30/2018 11:00 AM | Awarded |
| `33B-2020` | 5/27/2020 11:00 AM | Awarded |
| `29B-2022` | 5/18/2022 11:00 AM | Awarded |
| `50B-2023` | 5/16/2023 11:00 AM | Awarded |
| `27B-2024` | 4/24/2024 11:00 AM | Awarded |
| `36B-2026` | 6/17/2026 11:00 AM | Awarded |

Collapsing these destroys precisely the recurring-contract history — pricing cadence, award
timing, vendor turnover — that makes this dataset valuable to a contractor. Other affected groups
follow the same annual-recompete pattern: "No-Lead Brass Service and Threaded Fittings" (×5,
2018–2025), "Fire Hydrants" (×4, 2019–2024), "PVC Pipe, PVC Fittings, and Couplings" (×3),
"Solar Salt (Coarse)" (×3, 2019–2026).

### 8b. The group that defeats a year-aware heuristic

Because 27 of 28 groups span years, a natural refinement is "same title + different year =
distinct; same title + same year = duplicate." The 28th group breaks that rule:

| "Arne Hanna Aquatic Center Filter Replacement" | Due | GUID tail |
|---|---|---|
| `45B-2025` | 7/22/2025 11:00 AM | `…1be1e5eb9e65` |
| `74B-2025` | 10/7/2025 11:00 AM | `…294e0b41d79a` |

Same title, same year, eleven weeks apart, two distinct GUIDs — the shape of a re-bid after a
first solicitation failed or was re-scoped. These are two genuinely separate solicitations, and
any same-year heuristic merges them and loses one. **Fact:** the data cannot confirm the re-bid
interpretation; what it does confirm is that same-title/same-year is not sufficient evidence of
duplication.

### 8c. The failure mode that only appears in the broken file

All 500 candidate `Title` values are `""` — the candidate file contains **exactly one distinct
title value**. A `Title`-keyed dedupe run against the candidate would collapse all 500 records
into a single group and emit **one record**.

This is the strongest argument for the recommended key. The scraper regression would silently
convert a title-based dedupe from "8.4% data loss" into near-total destruction, and it would do so
without raising any error — the dedupe would report a successful run. A dedupe key must be built
from fields whose failure is *visible*, and `BidURL` is the field this regression left completely
intact.

### 8d. `48B-2025-Clone-Clone`

This is the one record carrying a duplicate-shaped marker in the source system. Facts: it has its
own distinct GUID, so ProcureWare treats it as a separate record; no `48B-2025` or
`48B-2025-Clone` sibling exists in either export; and its `Title` twin is **`40B-2020`** — a
different record five years earlier, with an unrelated due date.

That last point matters: even the one record explicitly labelled a clone does **not** pair with
its title match. Inferring a parent/child relationship from either the `-Clone` suffix or the
shared title would be inventing a business rule, forbidden by rule 1. Per rule 5, fuzzy title
similarity may surface such records for review but must never drive dedupe output.

### Recommended dedupe key (assumption requiring approval)

**`AgentID` + `BidURL` (normalized)** — identical to the primary match key.

Rationale: `BidURL` contains the source system's own GUID, which is the only identifier here that
is both guaranteed unique (1000/1000 across both files) and not human-editable. Using the same key
for matching and dedupe keeps provenance records coherent — a record's identity means the same
thing in a drift report as in a deduplicated export. `AgentID` scopes it so exports from multiple
agents can be merged safely.

Records differing only by a `-Clone` suffix should be surfaced as **review candidates with a
`possible-source-clone` flag, never merged automatically.**

---

## 9. Facts vs. assumptions — summary

### Established from the files

- Both files carry a UTF-8 BOM and fail `JSON.parse` unmodified; both are valid JSON once stripped.
- Shape is `{"Export": [...]}`; records live at `$.Export[*]`; 500 records each; 45 all-string
  fields each; identical key sets and key order.
- 499 shared records, 1 reference-only, 1 candidate-only, 99.80% match rate.
- `BidURL` and `ProjectCode` are each 100% unique and non-blank in both files and agree on
  pairing in 499/499 cases. `AgentID` and `LegacyAgentID` are constants.
- Eight fields are `""` in 500/500 candidate records: 100% loss of every populated value.
- `Description`, `ConferenceDescription`, and all document fields survived essentially intact.
- One description shows a genuine content update; two records lost document arrays; three records
  are near-empty shells.
- `Created`/`Refreshed` moved for all records, as expected between runs.
- No exact duplicates on any key. 28 shared-title groups are recurring annual solicitations.
- 22 fields are empty in both runs, including `ContractValue`.
- **Zero comparable pairs** exist for any of the eight failed fields — no record has a non-blank
  value on both sides — so their cross-run volatility is unmeasurable from this file pair (§6a).
- `38B-2026`'s surviving description proves its deadline moved from July 29 to August 4th, while
  the reference `DueDate` still reads `7/29/2026`. A backfill would have written a stale
  deadline to a live bid (§6c).
- Only 5 of 500 reference records were future-dated at run time; they are the same 5 marked
  `Open for Bidding`, and one (`32B-2026`) had its deadline expire within an hour of the candidate
  run (§6d).
- Contact-field presence is year-correlated (100% in 2018–2019, 0% phone from 2025), so backfill
  eligibility concentrates in long-closed records. Values are non-uniform: 4 email variants,
  2 phone formats (§6e).
- A `Title`-keyed dedupe would delete 42 of 500 reference records (8.4%); against the candidate,
  where all 500 titles are `""`, it would collapse every record into one group (§8a, §8c).
- `48B-2025-Clone-Clone` shares its title with `40B-2020`, an unrelated record five years earlier
  (§8d).

### Assumptions requiring your approval

1. That `lambda-20260715-080212-d3836a0d_2026-07-15.json` is the intended candidate despite the
   `-2` naming mismatch.
2. That `AgentID` + normalized `BidURL` should be the primary match key and dedupe key.
3. That `AgentID` + `ProjectCode` should be the fallback key.
4. Which fields, if any, may be auto-backfilled. **The proposed profile ships with
   `safeBackfillFields` empty — deny-by-default.** My recommendation is to promote
   `ContactPhone` and `ContactEmail` first, and to consider `BidType` and `Title` separately.
   Nothing is authorized until you edit that file.
5. That `Created` and `Refreshed` should be excluded from drift comparison as run stamps.
6. That 0.95 is the right `minimumMatchRate` gate (observed: 0.998).
7. That the header/summary-block extraction hypothesis is worth acting on. Confirming it requires
   the scraper source and current page HTML, neither of which is in scope here.

### Not determinable from these files

- The specific failing selector or code path.
- Whether the trigger was a vendor markup change, a scraper deploy, or a dependency upgrade.
- Whether the 500-record count is a hard cap, and if so what its eviction policy is.
- Whether `Title`, `BidType`, or any of the eight failed fields are stable across runs — the
  candidate has no values to compare against. This requires a second known-good run.
