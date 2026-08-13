# Production-Readiness Audit — json-data-drift-analyzer

**Date:** 2026-08-11 · **Scope:** full repository at `main` as of commit `30f63fb` (static review of all source, config, CI, and e2e files; three independent review passes over engine/worker, UI/state, and infrastructure, with top findings re-verified against source)

> **Remediation status (2026-08-11):** Phases 1–3 of §6 are implemented and merged to `main`:
> Phase 1 correctness (`22202c6`), Phase 2 CI/supply chain (`a940c85`), Phase 3 durability (`26bfd91`).
> **Remaining: Phase 4 (polish)** — see the handoff section directly below.
> Findings text below is left as originally written — read it against the commits above.

---

## Session handoff — start here

*Update 2026-08-12 (later session): the profile model was restructured for
400+ sources on `feature/source-profile-scaling` — base + per-source deltas
(`src/profiles/base.json` + `sources/*.json`, auto-registered), the quality
`defaultProfile` absorbed into the profile as its `quality` section
(Bellingham → v6), a `policyHash` identity stamped through every audit
surface, local overrides in Dexie v6 with a `/profiles` management page,
a searchable picker with URL-based auto-detection, and a policy-manifest CI
gate (`npm run profiles:manifest`) plus `npm run new-profile` scaffolding.
See the CHANGELOG's Unreleased section for the user-facing summary.*

*Rewritten 2026-08-12 at the end of the Phase 4 session. All four planned
remediation phases have landed; what follows is the state a fresh contributor
(human or agent) actually needs.*

### State as of `c601aca`

`main` is green and deployed. Phases 1–4 of the audit remediation are complete:
every Critical/High/Medium finding is fixed with proving tests, and the Phase 4
polish items landed in PRs #49–#53:

- **#49** vitest + coverage-v8 → 4.1.10 (jointly — either alone fails `npm ci`),
  CI coverage gating, actions/cache v6, and a dedicated `tsconfig.e2e.json`
  (e2e specs lost node types when vitest 4 cleaned up its type chain).
- **#50** keyboard access (§2.5): table rows focus and select via Enter/Space,
  `aria-sort` on columnheaders, `DateOrderingAlert` is a real modal (focus trap,
  Escape, restore), toast live region always mounted with `role="alert"` errors.
- **#51** AGENTS.md grounding refreshed (profile registry, version 4,
  ContractValue).
- **#52** draft persistence (§2.6): decision-form text and the ticket form live
  in `src/stores/draft-store.ts`, keyed per analysis, surviving virtualization
  scroll and tab switches.
- **#53** `noUncheckedIndexedAccess` on in all tsconfig projects (367 sites,
  assertions only where provably in range, no silent fallbacks);
  `e2e/failure-paths.spec.ts` (malformed JSON, blocked export, Data Health,
  Trello against a `page.route()` mock); CSP spec detects violations via a
  `securitypolicyviolation` listener with a canary proving the listener fires.

### The work that remains

Every finding in this audit is now resolved. The TypeScript 5.9 → 7.0 migration
landed in #55, and the Low-severity items landed in #57–#59 (engine/db/worker,
UI, build/tooling — with a wrong collection path now quarantining loudly instead
of passing over zero records) plus the #60 follow-up. Two notes:

- **Equal export timestamps** (§1.5) are resolved by wording rather than a code
  split: the date-ordering alert says "is not older than latest", which is
  accurate for both the reversed and the equal case. Split the copy if the
  distinction ever matters.
- **Release hygiene** (§4) is fully done as of `v1.0.0` (#62): semantic
  versioning with the contract defined in CHANGELOG.md, the version stamped
  next to the commit in the footer and export metadata, and a documented
  tag-and-release process in the README.

**Coverage thresholds** (`vitest.config.ts`: 76/70/70/78) are anchored just
below coverage measured against the whole `src/` tree — the denominator is
deterministic now (`coverage.include`), so it no longer shifts when a test
imports new files. Re-anchor upward as coverage grows; the untested pockets are
`ui-store.ts` and parts of the page components.

### Environment

- **Node ≥ 20.19** (22 LTS fine). Vite 8 needs `util.styleText`; Node 21.6 fails
  to build with a bare `SyntaxError` naming that import.
- `npm ci`, then `npm run test` / `lint` / `typecheck` / `build` / `test:e2e`.
  After a Playwright version bump, run `npx playwright install chromium` — the
  cached browser is keyed to the version and e2e otherwise dies with
  "Executable doesn't exist".
- For PR automation: `gh auth login`, **plus `gh auth refresh -h github.com -s
  workflow`**. Without the `workflow` scope, merging any PR that touches
  `.github/workflows/**` is refused by the API; the working fallback (used for
  #49) is merging locally and pushing over SSH.

### Traps prior sessions hit — worth not repeating

1. **Record ids are not display keys.** `record.id` is the JSON-serialized
   identity key (collision-proof); `record.recordKey` is the human-readable
   label. A testid built from `record.id` silently became
   `record-["91B-2023"]` and broke e2e until `f05d362`. When touching record
   identity, grep for `record.id` in **testids, URLs, and exports**.
2. **A red pipeline is usually protecting the site, not failing it.** The deploy
   job refuses to publish when any gate is red — including the coverage gate,
   which blocked `main`'s deploy for one commit in this session when thresholds
   measured on a feature branch turned out to sit above merged `main`'s
   coverage. Anchor thresholds against `main`, and read a failed deploy as "the
   gate held" before theorizing about flake. The `playwright-report` artifact is
   uploaded on failure.
3. **Piped typecheck output lies about the exit code.** `npm run typecheck |
   tail` exits with tail's status, so a broken build can print "OK"-looking
   summaries. Check `tsc -b`'s own exit code, and cold-check with
   `rm -rf node_modules/.tmp` when switching branches — stale `.tsbuildinfo`
   masks errors.
4. **The Bellingham fixtures carry a UTF-8 BOM** (deliberately — real scraper
   exports do). Anything that `JSON.parse`s them outside the engine (e2e specs,
   scripts) must strip `\uFEFF` first; the engine's `parseJSON` already does.
5. **Parallel PRs can each be green and still break `main` together.** #58
   added `coverage.all` to vitest.config.ts while #59 made that file
   typechecked; vitest 4 had removed the option, so only merged `main` failed
   (#60 fixed it). When two open branches touch config and the tooling that
   checks that config, run the combined gates locally before assuming green
   PRs make a green main.

---

## Executive summary

This is an unusually well-engineered codebase for its size. The auditability design (append-only decision log, provenance with rule IDs and profile versions, injectable timestamps, run-fingerprint duplicate-post protection), the honest CSP with written rationale for each weakening, and the worker key-echo correlation are all above professional baseline already. The documentation is accurate in spirit and the test suite is substantial (34 test files, including an 8k-record scale test).

The gap to "production ready for professional use" is concentrated in four places:

1. **Three correctness bugs in the engine** that produce *wrong or empty analysis with no error* — the worst failure mode for a forensics tool: document diffing is silently inert on the shipped profile's real data, per-field regression counts pair records by array position instead of identity, and the diff-layer record key is forgeable/collapsible.
2. **Failure-path robustness in the UI**: a crashed worker strands the UI forever, there is no error boundary, and an IndexedDB failure on the cache-read path blocks analysis entirely.
3. **CI/supply-chain hygiene**: a write-capable token exposed to the test job, the deployed bundle being a different build than the tested one, and no dependency scanning.
4. **Scale ceilings**: unbounded IndexedDB cache growth and per-cell finding materialization that will OOM a tab on exactly the large systemic-loss incident the tool exists to diagnose.

None of these are architectural — the architecture is sound. Estimated effort to clear everything rated High or Critical: a few focused days.

**Severity counts:** 3 Critical-impact correctness · 8 High · 15 Medium · ~14 Low.

---

## 1. Engine correctness (highest priority)

These three produce incorrect results silently. For a tool whose whole value is evidence quality, they are the production blockers.

### 1.1 Document diffing is silently inert on real Bellingham data — HIGH/CRITICAL
`src/engine/documents.ts:29` · `src/engine/diff.ts:184`

Your own profile notes state it plainly (`bellingham-procureware.json` line 58): list-valued fields (`BidDocuments`, `BidDocumentHashes`, …) arrive as **JSON-encoded strings** (`"[]"`, `"[{…}]"`) and "must be decoded before document-level diffing." Nothing ever decodes them. `normalizeDocuments` does `if (!Array.isArray(value)) return []`, so on the shipped profile's actual data every document diff is all-zeros: removed documents, hash mismatches, and `byDocumentState` indexes report nothing, without any error. The feature looks like it works.

**Fix:** in `normalizeDocuments`, when the value is a string, attempt a guarded `JSON.parse` before the array check (or pre-decode fields listed in a profile `validation.jsonFields` entry during normalization). Add a test that feeds the JSON-in-string shape — the real fixtures already contain it.

### 1.2 Field stats pair baseline/latest records by array index, not identity — HIGH
`src/engine/quality.ts:35–43`

`emptyRegressionCount` compares `baselineRecords[i]` against `latestRecords[i]`. Your profile's own measurements record that only 4 of 499 shared records occupy the same index across runs. With reordered exports (the normal case), per-record regression counts are computed between unrelated records — and that count feeds `getSeverityFromPopulationDrop`, which drives field severities and the Pass/Warning/Quarantined gate. The aggregate fill-rate math is fine; the per-record pairing is noise.

**Fix:** key both sides by the identity key (as the diff pass already does) and count regressions over matched pairs only.

### 1.3 Diff-layer record key is forgeable and collapses records — HIGH
`src/engine/identity.ts:6` · consumed at `src/engine/diff.ts:151`

`buildRecordKey` joins values with `"::"`. This has three failure modes: (a) `["a::b","c"]` and `["a","b::c"]` collide, so two distinct records merge and one silently vanishes (Map last-wins); (b) a typo'd identity field name yields key `""` for *every* record, collapsing the whole analysis into one record; (c) genuine duplicates silently diff against whichever came last. The codebase already contains the correct solution — `buildIdentityKey` in `normalize.ts:101` JSON-serializes each component precisely to prevent this — it just isn't used here.

**Fix:** reuse the JSON-serialized composite key, and surface null/empty-key records explicitly instead of keying them `""`.

### 1.4 Hostile or unusual JSON keys corrupt analysis structures — MEDIUM-HIGH
`src/engine/diff.ts:200` · `src/engine/indexes.ts:22,39`

`recordsById[key] = …` and `byField[path] = new Set()` use plain objects. A record keyed `__proto__`, or containing a `"__proto__"` field (scraped data is attacker-influenced), hits the prototype setter: the record vanishes from `Object.values`, counts and indexes disagree, no error. **Fix:** use `Map` or `Object.create(null)` for these three structures, or reject `__proto__`/`constructor`/`prototype` path segments. Add a hostile-key test.

### 1.5 Other engine findings (Medium/Low)

- **`deepDiff` equality via repeated `JSON.stringify`** (`diff.ts:49,65`): order-sensitive inside arrays (`[{a,b}]` vs `[{b,a}]` → false "modified"), O(size×depth) restringification, unbounded recursion on pathological nesting (surfaces as an opaque "Maximum call stack size exceeded" for the whole run). `qa.ts` already has `canonicalize` solving the ordering problem — share it, add a depth cap. — *Medium*
- **32-bit FNV-1a finding IDs** (`findings.ts:81–107`): ~50% collision odds within a category by ~77k findings; a large systemic regression exceeds that. Collisions conflate findings in `ExcludedRecord.findingIds` and CSV. Use 64 bits or embed recordKey/fieldPath. — *Medium*
- **`assertNoSecrets` matches substrings** (`export.ts:190–204`): a scraped field named `SecretaryName` or `TokenNumber` throws — and since `buildExportBundle` (line 605) has no per-artifact error handling, *every* artifact fails, including the reports that "always export." Use boundary-aware patterns and wrap each builder so one blocked artifact can't take down the rest. — *Medium*
- **Manual override consumed, then record excluded** (`recovery.ts:411–413` vs `:456–469`): an override on a record the hard-required gate later excludes is marked applied, appears in provenance, but is in neither the artifact nor `unappliedOverrides` — the exact log/artifact disagreement the module doc promises can't happen. — *Medium*
- **Worker message handling** (`analysis.worker.ts:19–26`): `event.data.type` is read outside the `try`; a malformed message becomes a silent unhandled rejection and the UI never hears back. Guard `event.data?.type`, add top-level worker `error`/`unhandledrejection` handlers. — *Low, but pairs with UI finding 2.1*
- **Dexie v2 upgrade never drops the removed `profiles` store** (`db/index.ts:71–74` — needs `profiles: null`); **`getCollection` admits arrays as records** (`normalize.ts:113` — add `!Array.isArray`); **equal export timestamps flagged as "reversed"** (`export-metadata.ts:105` — use `>` and report equality separately); **duplicate document hashes silently collapse in a Map** (`documents.ts:80–89`); **hard-coded Bellingham field names in engine code** (`search.ts:122`, `diff.ts:14` — contradicts your own "no source field names in the engine" rule; drive from profile); **`qualityGate: "Failed"` is declared but unreachable** (`types.ts:128`); **`bellinghamProcureware as SourceProfile` cast bypasses checking and `findProfileContradictions` never runs on the load path** (`profiles/index.ts:18` — use `satisfies` + assert in `getProfile`). — *Low*

---

## 2. UI robustness and failure paths

### 2.1 Worker failure strands the UI in "running" forever — HIGH
`src/features/upload/analysis-runner.ts:40` · `UploadPage.tsx`

The runner attaches only `onmessage`. If the worker module fails to load, the browser kills it (OOM on a big export), or a message fails structured clone, no error ever arrives: progress freezes, `running` stays true, Analyze stays disabled, no message. **Fix:** attach `worker.onerror` and `onmessageerror` in `createAnalysisRunner` and route them to the active run's `onError`, clearing `active`.

### 2.2 No error boundary; a render error or stale lazy chunk blanks the app — HIGH
`src/app/router.tsx` · `main.tsx`

No `errorElement`, no ErrorBoundary. After a redeploy, a user with a stale `index.html` who opens the lazily-loaded Recovery page gets a chunk-fetch failure → blank screen, losing in-memory analysis context. **Fix:** `errorElement` on both routes plus an app-level boundary with a "reload / start over" affordance.

### 2.3 IndexedDB failure blocks analysis instead of degrading to uncached — HIGH
`src/features/upload/UploadPage.tsx:119`

`await db.analyses.get(analysisKey)` is on the critical path inside the main `try`; in Firefox private mode or with a corrupted DB it rejects and the analysis never runs, showing a raw error. Every *other* db call in the file degrades gracefully — this one should too: `.catch(() => undefined)` → treat as cache miss.

### 2.4 Abandoned runs are never cancelled and can hijack navigation — HIGH
`UploadPage.tsx:152–172` — `runner.cancel()` exists but is called nowhere. Start a slow run, hit "New analysis," pick new files: Analyze refuses ("already running"), and minutes later the stale closure fires `setAnalysis(oldResult)` + `navigate('/results')` mid-configuration. **Fix:** cancel on unmount/reset; only navigate if still current.

### 2.5 Core tables are mouse-only — HIGH (accessibility)
`RecordsTable.tsx:130` · `FieldChangesTable.tsx:184` — rows are `div role="row"` with `onClick` only: no `tabIndex`, no key handler. Keyboard users cannot open record detail or drill into fields — the core triage workflow. Related: the `DateOrderingAlert` "alertdialog" has no focus trap/initial focus/Escape (`DateOrderingAlert.tsx:15`); `aria-sort` sits on the `<button>` instead of the columnheader; the toast live region mounts on demand so screen readers miss it, and errors use polite `role="status"` instead of `role="alert"`.

### 2.6 Medium UI findings

- **Duplicate Trello-post protection misses cross-run duplicates** (`ContractorTicketPage.tsx:30`): prior attempts are loaded by `analysisKey` (per-run) but compared by `runFingerprint` (stable across runs). After a cache invalidation, re-posting identical files raises no duplicate warning. Query by the already-indexed `runFingerprint` instead.
- **F5 on results loses everything despite the cache** (`ResultsShell.tsx:33`): store is memory-only; `db.analyses` is read only on the Analyze path. Put the analysis key in the URL and hydrate in ResultsShell, or offer "restore last analysis."
- **Both files fully `JSON.parse`d on the main thread at selection time** (`lib/file-order.ts:18`): the date sniff freezes the tab on very large exports before Analyze is even clicked; no file-size guard exists anywhere. Move the sniff into the worker or size-cap it.
- **Decision queue rows are fixed-height in the virtualizer** (`DecisionQueue.tsx:68–73`): opening the decide form overflows 92px and overlaps the next row — in the UI where careful reading matters most. Use `measureElement` as RecordsTable already does.
- **Typed decision drafts and the ticket form are lost on scroll/tab-switch** (`DecisionRow.tsx:35`, `ContractorTicketPage.tsx:21`): row-local state unmounts with virtualization; tab unmount discards a half-written ticket and the Trello token. Lift drafts to the store keyed by cell ID.
- **Trello client edge** (`lib/trello.ts:80–82,174–188`): untrimmed pasted credentials (trailing newline, quote) make `fetch` throw *before any network I/O*, but the catch classifies it as `network`/`cardCreated:"unknown"` — telling the user to go check the board for a request that never left the browser. Trim before use; classify pre-send TypeError as configuration failure. Also add `autoComplete="off"` to the token field so password managers don't offer to persist the token the design works to keep memory-only (`TrelloPostPanel.tsx:143`).
- **Low:** unknown `?tab=` renders an empty shell (fall back to overview); `crypto.subtle` crash on plain-HTTP origins surfaces as a cryptic TypeError (detect and explain); column-resize hooks call storage writes inside setState updaters (impure under StrictMode).

---

## 3. Scale and storage

- **The analysis cache is never pruned** (`db/index.ts` — writes only, no delete/LRU anywhere): each `SavedAnalysis` holds full `recordsById`, the serialized search index, and every finding. A professional running daily comparisons hits browser quota in weeks, after which every `put` fails forever with only a toast. **Fix:** prune by the existing `createdAt` index to a count/byte budget after each `put`; catch `QuotaExceededError` specifically and evict-then-retry. — *Medium-High for professional use*
- **QA materializes one finding object per regressed cell** (`qa.ts:496–518`): an 8-field systemic loss over 100k records → ~800k finding objects, structured-cloned, persisted, pretty-printed into the quality report, and rendered as CSV. The tab OOMs on exactly the incident this tool exists for. **Fix:** once systemic loss is proven for a field, sample K exemplars and keep exact counts. — *Medium*
- **Cache invalidation depends on hand-bumped constants** (`db/index.ts:13`): the key covers hashes/config/profile versions/shape version, but an engine *behavior* fix (e.g., fixing finding 1.2) serves stale wrong results indefinitely to anyone with a cache entry. Fold a build hash or engine-semantics version into the key. — *Medium*
- **Quadratic-ish quality-issue construction and per-call Set allocation** (`quality.ts:116–132`, `empty.ts:35`): full record scans per regressed field and ~13.5M throwaway Set merges at 100k×45 fields. Reuse the `byField` index; cache merged placeholder sets. — *Low-Medium*

---

## 4. CI, supply chain, and build

- **Write-capable token exposed to the test job — HIGH** (`deploy.yml:8–9`): workflow-level `permissions: contents: write` means `npm ci` (375 packages' postinstall scripts) runs with push access on every same-repo PR. Set top-level `contents: read`; grant write only in the deploy job — or better, switch to `actions/upload-pages-artifact` + `deploy-pages` with `pages: write` + `id-token: write`.
- **The deployed bundle is not the tested bundle — HIGH** (`deploy.yml:58–69`): the deploy job rebuilds from scratch, so what ships never ran the e2e suite, and "which build is live?" has no answer. Upload the tested `dist/` as an artifact and deploy that.
- **No deploy concurrency guard — Medium**: two rapid pushes can race and the older build can win the force-push. Add a `concurrency: { group: pages-deploy }` block.
- **No dependency scanning — Medium**: no Dependabot/renovate, no `npm audit` step, no SECURITY.md. For an app whose security story is "CSP + no backend," add `.github/dependabot.yml` (npm + github-actions) and `npm audit --omit=dev --audit-level=high` in CI. Also pin actions to commit SHAs (tags are mutable, and `peaceiris/actions-gh-pages@v3` is a major behind).
- **Coverage configured but never run, no thresholds — Medium** (`vitest.config.ts:9–12`): CI runs `npm run test` without `--coverage`. Run with coverage and gate `src/engine/**` at meaningful thresholds; add `coverage/` to `.gitignore`.
- **Playwright config gaps — Medium** (`playwright.config.ts`): no `forbidOnly` (a committed `.only` shrinks the suite silently and CI stays green), no CI retries, no traces on failure. Also: the functional suite runs against the **dev server**; only `csp.spec.ts` exercises the production build. Point the main project at the preview server.
- **tsconfig — Low**: `strict` is real, but add `noUncheckedIndexedAccess` — the engine indexes into `Record<string, unknown>` constantly, and unchecked index access is exactly where a wrong-field read hides. Also `tsconfig.node.json` typechecks only `vite.config.ts`; include the vitest/playwright/tailwind configs.
- **oxlint gate is thin — Low** (`.oxlintrc.json`): two explicit rules, warnings can't fail CI. Run `oxlint --deny-warnings` and enable correctness categories + `exhaustive-deps`.
- **No production sourcemaps — Low** (`vite.config.ts`): combined with the (legitimate) no-telemetry stance, a field crash is an undiagnosable minified stack. The repo is public — `build.sourcemap: true` costs nothing and restores debuggability.
- **Release hygiene — Low**: version frozen at 0.1.0, no tags/CHANGELOG, and no build identifier in the UI or export metadata — a "wrong numbers" report can't be tied to a build. Stamp the commit SHA via `import.meta.env` into the footer and export metadata (this also helps the cache-invalidation finding above).
- **Docs drift — Medium**: `AGENTS.md`'s self-described *binding* grounding section is now false on three counts (says no profile registry exists, profile at older version, "`ContractValue` appears nowhere"). A binding doc that mis-describes the policy layer will steer contributors to re-implement what exists. Update it.
- **E2E coverage gaps — Low**: no malformed-JSON/wrong-collection-path journey, no quarantined/blocked-export run, no `page.route()`-mocked Trello POST (the real fetch path + CSP `connect-src` interaction is never e2e-verified), Data Health tab never visited, and the CSP spec detects violations by matching Chrome's console phrasing — add a `securitypolicyviolation` listener via `addInitScript` so a wording change can't make it vacuous.

---

## 5. What's already strong (keep it)

The matching semantics are carefully reasoned and safe — exact-only, fallback ambiguity judged against the whole reference population, collision-proof identity keys (in `normalize.ts`), date-sensitive double-approval gating. The auditability engineering is the standout: injectable timestamps, append-only decision log with persisted sequence numbers, provenance carrying rule IDs and profile versions, `unappliedOverrides`/`accountedFor` invariants. Export hardening (CSV formula-injection neutralization, credential tripwires, RFC 4180 output) is above average for a browser tool. The Trello client's honest "unknown — may have posted" outcome and arm-then-confirm flow, the build-time-only CSP actually exercised by e2e against the real bundle, the Playwright cache keyed on the installed version with reasoning documented, and a clean lockfile (registry.npmjs.org only, full integrity hashes) all reflect real care. The `bellingham-procureware.json` evidence notes are exemplary — notably, they document finding 1.1 as fact while the code doesn't act on it.

---

## 6. Recommended order of work

**Phase 1 — correctness (do first, ~1–2 days):** 1.1 document decoding · 1.2 identity-keyed field stats · 1.3 record key · 2.1 worker error handlers · 2.3 cache-read degradation · 2.2 error boundary. Each comes with an obvious regression test; 1.1's test should use the real fixtures.

**Phase 2 — CI/supply chain (~half day):** token scoping · deploy the tested artifact · concurrency guard · Dependabot + audit step · `forbidOnly`/retries/traces · SHA-pin actions.

**Phase 3 — professional-use durability (~1–2 days):** cache pruning + quota handling · engine-version in cache key + build SHA stamping · finding sampling for systemic loss · run cancellation · cross-run Trello duplicate check · restore-from-cache on refresh.

**Phase 4 — polish:** keyboard access for tables and the dialog · draft persistence · `noUncheckedIndexedAccess` · coverage gating · AGENTS.md refresh · e2e failure-path journeys · remaining Lows.

---

*Method note: dependency installation was blocked in the audit sandbox (registry proxy 403s on several pinned versions), so this review is static — the unit/e2e suites were not executed here. All High-severity findings above were manually re-verified against source before inclusion.*
