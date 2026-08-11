# Proposal — minimal Trello integration

**Status: IMPLEMENTED.** This design was subsequently built — the client lives in
`src/lib/trello.ts` and the UI in `src/features/trello/TrelloPostPanel.tsx`. One
deliberate deviation from §0 below: CORS verification showed Trello accepts an
`Authorization` header, so credentials travel in that header and never in the URL,
where a secret reliably leaks into history and logs. Kept as a historical design
record; where this document and the code disagree, the code and its tests win.

Governed by `AGENTS.md`, in particular rule 8 (browser/local-first, no backend unless
asked), rule 9 (secrets never committed; Trello tokens user-entered locally or supplied
at runtime), and rule 11 (no network write or card creation without a user-facing
confirmation step).

The tool today produces a ticket draft — `{ title, markdownDescription, suggestedLabels,
severity }` from `src/engine/ticketTemplate.ts` — and the user copies it into Trello by
hand. This proposes the smallest change that creates the card instead, without weakening
anything the manual handoff currently guarantees.

---

## 0. The precondition that decides whether this is possible at all

**This design assumes `api.trello.com` permits cross-origin requests from a browser page
with `Authorization` supplied as query parameters. That must be verified before any code
is written.** Everything below collapses if it does not.

Verification is one command, no code and no account changes beyond a token:

```
curl -si -X OPTIONS 'https://api.trello.com/1/members/me/boards' \
  -H 'Origin: https://sophanasok.github.io' \
  -H 'Access-Control-Request-Method: GET'
```

Look for `Access-Control-Allow-Origin`. Then repeat for `POST /1/cards`, because a
preflight for a write is the case that actually matters.

**If CORS is not permitted**, a purely local-first integration is impossible and the
options are, in order of preference:

1. **Keep the manual handoff.** It works today and costs one paste.
2. **A local helper the user runs themselves** — a short script on their machine that
   reads an exported ticket file and posts it. Still no hosted backend, still no token in
   a browser, and it sidesteps the whole storage risk in §7.
3. **A hosted proxy.** This is a backend. AGENTS.md rule 8 forbids introducing one
   unless explicitly asked, and it would move the token from the user's browser to a
   server someone has to operate and secure. Not recommended.

The rest of this document assumes (1) verification succeeds.

---

## 1. Required local configuration shape

Split deliberately into two halves: what may be persisted, and what may not.

```ts
/** Persisted. Contains no secret. */
type TrelloTarget = {
  /** Trello API key. Identifies the app, not the user. Low sensitivity, but still user-entered. */
  apiKey: string;
  boardId: string;
  boardName: string;   // cached for the confirmation dialog, so it never shows a bare id
  listId: string;
  listName: string;
  /** suggestedLabel -> Trello label id. Unmapped labels are reported, never invented. */
  labelMap: Record<string, string>;
};

/** NEVER persisted by default. See §7. */
type TrelloCredential = {
  token: string;
  /** Where the user allowed this to live for the session. */
  retention: "memory" | "session";
  /** From the authorize URL, so the UI can warn before it lapses. */
  expiresAt: string | null;
  scope: "read" | "read,write";
};
```

**Why the split.** The board and list ids are not secrets and are tedious to re-enter;
persisting them is a real convenience with no exposure. The token is the whole risk, and
persisting it buys only keystrokes.

**Where each lives.** `TrelloTarget` in the existing Dexie database, alongside analyses
and decisions — one row, so it is inspectable and clearable with the rest of the app's
data. `TrelloCredential` in memory (a store field), or in `sessionStorage` only if the
user explicitly opts in per session. **Never `localStorage`.** §7 explains why that is
not a stylistic preference.

**Nothing goes in the repository.** No key, no token, no board id in any committed file,
fixture, or default. `assertNoSecrets` already refuses to export credential-shaped
content and would cover a config accidentally serialized into an artifact.

---

## 2. API interaction boundaries

**Three endpoints. No others.**

| Purpose | Call | When |
|---|---|---|
| List boards the user can write to | `GET /1/members/me/boards?fields=name` | Configuration only |
| List lists on the chosen board | `GET /1/boards/{boardId}/lists?fields=name` | Configuration only |
| Create the card | `POST /1/cards` | Once, after explicit confirmation |

Optionally `GET /1/boards/{boardId}/labels` to build `labelMap`, still configuration-only.

**What is sent.** Exactly the ticket the user reviewed: `name` (title), `desc`
(`markdownDescription`), `idList`, and mapped label ids. Nothing else. No record data
beyond what the template already redacted and truncated, no analysis payload, no decision
log, no file contents.

**What is not sent, and the tradeoff.** No attachments in this MVP. The ticket body
already lists three filenames under **Attachments**, so a card posted without them
references files that are not there. Two honest resolutions, and this needs a decision:

- **(a)** Reword the template's attachments section to say the files are held locally and
  must be attached by hand. Keeps the "nothing but the ticket leaves the browser"
  property intact.
- **(b)** Attach the findings CSV, quality report, and recovery audit via
  `POST /1/cards/{id}/attachments`. More useful, but it uploads the full findings set —
  a materially larger disclosure than the ticket text, and it should be its own decision
  with its own confirmation, not a side effect of posting.

**Recommendation: (a) for the MVP.** It keeps the boundary a single card creation.

**Transport rules.** Explicit timeout on every call. `GET`s may retry; the `POST` may
not, ever — see §4. Credentials go in query parameters because that is what the API
takes; they must never be written to `console`, to a toast, or into any exported
artifact.

---

## 3. Confirmation UX contract

Rule 11 requires a user-facing confirmation before a network write. This is the contract
that satisfies it.

**Preconditions before the confirm control is even enabled:**

1. A token exists in this session. If it does not, the UI asks for one and explains it is
   not stored.
2. A board and list are selected, resolved to **names**, not ids.
3. The draft built without refusal (no credential, no invented selector).
4. No successful post already recorded for this run fingerprint (§4).

**The dialog must state, before anything is sent:**

- **What** — the exact title, and the description rendered or byte-counted, not summarized.
- **Where** — board name and list name, in words. Never a bare id.
- **What else travels** — "the title and description only; no files, no record data".
- **What cannot be undone** — this tool cannot delete a card it creates. Removal is
  manual, in Trello.
- **Which labels apply**, and explicitly which suggested labels have **no mapping** and
  will therefore not be applied. Silent label dropping is the kind of small dishonesty
  that erodes trust in the rest of the output.

**Interaction rules:**

- Two distinct actions: arm, then confirm. Matching the bulk-decision pattern already in
  the app.
- No "always allow", no remembered consent, no auto-post. Every card is confirmed.
- The confirm control is single-flight: disabled from click until the outcome is known.
- Cancel leaves no trace and posts nothing.

**After the call:**

- **Success** — show the card URL, and record the metadata in §5.
- **Failure** — show the category and what it means (§4), and state plainly whether a
  card may have been created.

---

## 4. Error handling and duplicate-post prevention

### The run fingerprint

A deterministic hash over what identifies this report:

```
profileId + profileVersion
+ candidate input SHA-256 + reference input SHA-256
+ ticket title + hash of markdownDescription
```

The input hashes are already computed for the exports. Same run, same policy, same
ticket → same fingerprint. Change the profile version or re-run against different files
and it legitimately differs, which is correct: that is a different report.

### Three layers, because one is not enough

1. **Local record.** Before posting, look up the fingerprint in the local store (§5). If
   a success is recorded, do not post; show the existing card URL instead.
2. **Remote marker.** Embed the fingerprint in the card description as a visible footer
   line (for example `Run fingerprint: a1b2c3d4`). Visible rather than an HTML comment,
   because Trello's renderer may strip comments and an invisible marker that silently
   vanishes is worse than none.
3. **Reconciliation.** When local state is missing — cleared storage, another machine —
   offer a pre-flight `GET /1/search` scoped to the board for the fingerprint. Found
   means already posted. This is the layer that makes the guarantee survive a cleared
   browser.

**Trello has no idempotency-key header**, so prevention has to be constructed this way
rather than delegated to the API.

### Error categories, and what each means for the user

| Condition | Card created? | What to do |
|---|---|---|
| Missing token / board / list | No | Configuration problem; fix and retry |
| `401` invalid or expired token | No | Token lapsed — re-enter; do not treat as a bug |
| `403` insufficient scope | No | Token was issued read-only; re-issue with write |
| `400` validation | No | Report the API's message verbatim; do not guess |
| `429` rate limited | No | Honour `Retry-After`; the user retries, not the app |
| `5xx` server error | **Unknown** | Do not auto-retry |
| Network failure or timeout | **Unknown** | Do not auto-retry |

**The ambiguous cases are the ones that matter.** A request that fails *after* leaving
the browser may still have created a card. Automatic retry is exactly how one report
becomes two.

So: on any unknown outcome, record the attempt locally with `status: "unknown"`, and tell
the user in plain words — *"This may or may not have created a card. Check the board, or
run the reconciliation search."* Retrying is then a deliberate act with the reconciliation
result in hand, never an automatic one.

---

## 5. Ticket metadata to persist locally

One row per attempt, in Dexie, append-only for the same reason the decision log is:

```ts
type PostedTicketRecord = {
  id: string;                  // attempt id
  runFingerprint: string;      // §4
  analysisKey: string;         // ties back to the run and its decisions
  status: "success" | "failed" | "unknown";

  // Provenance — the same tuple rule 7 requires elsewhere
  profileId: string;
  profileVersion: number;
  sourceRun: string | null;
  referenceRun: string | null;
  candidateSha256: string | null;
  referenceSha256: string | null;

  // What was reported
  title: string;
  descriptionSha256: string;   // proves what was sent without storing it twice
  severity: string;
  labelsApplied: string[];
  labelsUnmapped: string[];    // recorded because silent dropping is a lie by omission

  // Where it went
  boardId: string;
  boardName: string;
  listId: string;
  listName: string;
  cardId: string | null;
  cardUrl: string | null;

  // When and who
  attemptedAt: string;
  actor: "user";
  errorCategory: string | null;
  errorMessage: string | null;
};
```

**Never stored:** the token, the API key, or the full description (its hash is enough to
prove what was sent, and storing the body twice doubles what a leak exposes).

**Why append-only.** "Posted, failed, retried, succeeded" is a different history from
"posted once", and only the log distinguishes them — the same argument that governs the
decision log.

**Decision state.** `analysisKey` links the report to the decisions in force when it was
sent. Worth also recording a hash of the resolved decision set, so it is possible to tell
later whether the board reflects a report made before or after a batch of decisions.

---

## 6. Deployment-specific risk that changes the recommendation

The app is served from `https://sophanasok.github.io/json-data-drift-analyzer/`.

**GitHub Pages project sites share one origin: `sophanasok.github.io`.** `localStorage`,
`sessionStorage`, and IndexedDB are scoped to *origin*, not to path. So a token in
`localStorage` here is readable by **any other project page published under the same
GitHub account**, now or in future — including a repository forked from someone else and
published without close review.

That is not a hypothetical about a compromised dependency. It is the normal behaviour of
the platform this app is deployed on.

---

## 7. Threat and risk assessment: a Trello token in browser local storage

**Assessment: do not use `localStorage`. Default to memory; allow `sessionStorage` only
as an explicit, per-session opt-in.**

### What the token is worth

A Trello token is a bearer credential for the user's whole account, not for one board.
With `write` scope it can create, modify, and delete cards on **every** board that user
can reach — not merely this project's. Leverage far exceeds the feature's needs.

### Threats, most to least likely here

| # | Threat | Why it applies | Severity |
|---|---|---|---|
| 1 | **Same-origin sibling page** reads the token | Every GitHub Pages project on this account shares the origin (§6) | **High** |
| 2 | **XSS via a dependency** exfiltrates it | 281 packages; the app has **no Content-Security-Policy**, so an injected script may post anywhere | **High** |
| 3 | **Shared or persistent device** | `localStorage` survives browser restarts indefinitely; a token issued "never expires" outlives the user's memory of creating it | Medium |
| 4 | **Browser extension** with page access | Extensions can read page storage; common on work machines | Medium |
| 5 | **Copied or synced profile** | Profile sync carries `localStorage` to other machines | Low–Medium |
| 6 | **Devtools or screen sharing** | A token in the network tab or a config field during a call | Low |

### What each storage choice actually buys

| Storage | Survives | Exposure window | Verdict |
|---|---|---|---|
| Memory only | Nothing | The tab's life | **Default.** Cost: re-enter per session — seconds, for a rarely-used action |
| `sessionStorage` | Reload, not close | Tab lifetime | Acceptable **opt-in**; still same-origin readable |
| `localStorage` | Everything | Indefinite | **Not recommended.** Same-origin readable *and* permanent |

### Mitigations worth adopting regardless

1. **Scope and expire the token.** Trello's authorize URL supports a requested scope and
   an expiration. Ask for `write` and the shortest workable expiry — a lapsed token is a
   contained incident; a `never` token is a permanent one. *(Verify the exact parameters
   before relying on them.)*
2. **Add a Content-Security-Policy.** GitHub Pages cannot set headers, but a
   `<meta http-equiv="Content-Security-Policy">` can restrict `connect-src` to
   `'self' https://api.trello.com` and forbid inline script. That directly limits threat
   #2: an injected script could no longer post the token to an attacker's host. **This is
   worth doing whether or not Trello integration is ever built.**
3. **Never persist by default, and say so in the UI** at the point of entry.
4. **Offer an explicit "forget token" control**, and clear it on `reset()` with the rest
   of the session state.
5. **Keep it out of every artifact.** `assertNoSecrets` already covers exports; the same
   guard should cover anything new that serializes config.
6. **Document revocation.** The UI should link to Trello's token revocation page, so the
   response to "I think that leaked" is one click rather than a search.

### Residual risk after mitigation

With memory-only storage, a scoped short-lived token, and a CSP, the remaining exposure
is: a compromised dependency running *inside the tab while a token is entered*, or a
malicious browser extension. Both are real and neither is fully solvable in a local-first
browser app. Both are also materially smaller than the status quo of a permanent
account-wide token sitting in shared-origin storage.

**And the honest comparison:** the current manual handoff has *none* of this risk. The
integration saves one paste per report. That trade is worth making only if reports are
frequent enough for the paste to be a real cost — which, at one report per scraper
regression, it may well not be.

---

## 8. Decisions needed before any code

1. **Does Trello's API allow browser-origin writes?** (§0) Everything depends on it.
2. **Attachments: reword the template, or upload the artifacts?** (§2) Recommendation:
   reword for the MVP.
3. **Is the paste actually costly enough to justify this?** (§7) A fair answer may be no.
4. **Token retention default** — memory-only is recommended; confirm `sessionStorage`
   opt-in is acceptable.
5. **Add the CSP regardless?** Recommended independently of this feature.
