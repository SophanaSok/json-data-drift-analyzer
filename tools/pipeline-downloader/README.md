# pipeline-downloader

A manual-run Playwright prototype that signs in to the internal pipeline dashboard and
downloads **one** JSON export for **one** bot, under a deterministic filename, recording
what happened in a local run log.

It is a companion to the analyzer, not part of it. Nothing here is imported by the app,
and nothing here reaches the Vite bundle: this is a separate package outside `src/`, with
its own dependencies, its own tests, and its own TypeScript config. The app's
`npm run build`, `npm test`, and `npm run typecheck` do not see it.

## What this is not

Deliberately out of scope for this prototype. None of it is stubbed or half-built —
adding any of it is a separate decision.

- **No fan-out.** One bot per run. There is no loop over 400 bots, no queue, no concurrency.
- **No scheduling.** No cron, no daemon, no watcher. You run it, you watch it, it exits.
- **No credential persistence.** Nothing is written to disk, no keychain, no token cache.
  The browser context is created fresh each run and its session is discarded on exit.
- **No LLM in the loop.** The navigation steps are fixed selectors, so a failure points at
  a line rather than at a decision nobody can reconstruct.

## Setup

```bash
cd tools/pipeline-downloader
npm install
npx playwright install chromium   # skip if the repo's Playwright browsers are already installed
```

Credentials come from the environment and from nowhere else — not from a command-line
flag (which would land in shell history and in `ps` output) and not from a config file.
Either export them in your shell, or copy `.env.example` to `.env`, which is gitignored
and loaded automatically:

```bash
cp .env.example .env
$EDITOR .env
```

| Variable | Meaning |
| --- | --- |
| `PIPELINE_DASHBOARD_URL` | Base URL of the dashboard, scheme included. |
| `PIPELINE_USERNAME` | Login username or email. |
| `PIPELINE_PASSWORD` | Login password. |

Running without a `.env` prints `.env not found. Continuing without it.` That is Node
reporting the optional file was absent, not an error — it matters only if you expected
your credentials to come from there.

## Before the first real run: fill in the selectors

**This tool cannot download anything yet.** No details of the dashboard's UI were
available when it was written, so every selector in `src/selectors.ts` is set to the
sentinel `TODO_FILL_IN`, and the tool refuses to launch a browser while any remain:

```
Failed (config): src/selectors.ts still has 11 placeholder value(s): loginPath, usernameField, …
```

That refusal is the point. A plausible invented selector would fail deep inside a run
with a confusing timeout; an unfilled placeholder fails in a second and names itself.

Open the dashboard by hand with devtools and fill each one in. Prefer Playwright's
user-facing locators — `getByLabel("Password")` survives a redesign that
`div > form > input:nth-child(2)` does not. `runsPath` and `runRow` are templates:
`{botId}` and `{runTimestamp}` are substituted at runtime.

While the placeholders stand, `--dry-run` still exercises the argument, environment,
filename, and path wiring:

```bash
npm run download -- --bot-id lambda --run latest --kind candidate --dry-run
```

## Usage

```bash
npm run download -- --bot-id <id> --run <latest|timestamp> --kind <candidate|reference>
```

Run it from this directory — the `download` script belongs to this package, not to the
repository root.

| Flag | |
| --- | --- |
| `--bot-id <id>` | Required. Letters, digits, dot, dash, underscore; it becomes part of a filename. |
| `--run <latest\|timestamp>` | Required. `latest` resolves the newest run from the dashboard; otherwise pass the run timestamp exactly as the dashboard displays it. |
| `--kind <candidate\|reference>` | Required. Which export of that run to fetch. |
| `--headless` | Optional. Default is a **visible** browser, so you can watch a manual run and debug a broken selector. |
| `--overwrite` | Optional. Replace an already-downloaded file instead of stopping. |
| `--dry-run` | Optional. Check arguments, environment, and selectors; open nothing, write nothing. |
| `--help` | Show usage. |

Exit codes: `0` success, `1` the run failed, `2` the command or environment was wrong.

```bash
# newest run, watch it happen
npm run download -- --bot-id lambda --run latest --kind candidate

# a specific historical run, as the reference side of a comparison
npm run download -- --bot-id lambda --run "2026-07-14 19:49:20" --kind reference
```

## Output

Downloads land in `incoming/` (gitignored, created on first use) named:

```
{bot-id}_{run-timestamp}_{candidate|reference}.json
```

for example `lambda_2026-07-15-08-02-12_candidate.json`.

The run timestamp is always the one **read back from the dashboard**, even when you named
it on the command line, so the same run downloaded via `latest` and via an explicit
timestamp produces the same file. Characters that cannot appear in a filename become `-`;
the date is not otherwise parsed or reformatted, because inventing a format would break
the correspondence with what the dashboard shows.

A deterministic name means a repeat download is detectable as one: an existing file stops
the run rather than becoming `export (1).json`. Pass `--overwrite` when you mean it.

Downloads are written to a `.partial` file, checked, and only then renamed. A file in
`incoming/` is therefore complete and parses as JSON — including exports carrying a UTF-8
BOM, which the real scraper output does. A dashboard that answers an expired session with
an HTML login page is caught here rather than three steps downstream.

## Run log

Every attempt that named a bot appends a row to `run-log.csv` (gitignored), failures
included — a history that only records successes cannot answer the question anyone
actually asks it.

| Column | |
| --- | --- |
| `timestamp` | When the run started, ISO 8601. |
| `bot_id` | From `--bot-id`. |
| `requested_run` | What you asked for: `latest` or the timestamp you passed. |
| `resolved_run` | The run actually found. Empty if it never got that far. |
| `file_path` | Where the export landed. Empty on failure. |
| `outcome` | `success` or `failure`. |
| `error_category` | Empty on success; otherwise one of the categories below. |
| `message` | A short, redacted explanation. |

Error categories: `config`, `auth`, `navigation`, `run_not_found`, `download_timeout`,
`download_failed`, `invalid_payload`, `filesystem`, `unknown`.

## Retries

**A download timeout is retried twice; nothing else is retried at all.**

A timeout means the export never arrived, so re-triggering it repeats a read. Every other
failure is either permanent within the run — bad credentials, a run that is not listed, an
unfilled selector — or ambiguous enough that a blind retry just reproduces it more slowly.
The attempt count is recorded when it exceeds one.

This assumes the download control serves an export the dashboard already holds. If it
instead *queues a new export job*, a retry queues a second one, and that assumption needs
revisiting when `downloadControl` is filled in.

## Safe use

- **Credentials only from the environment.** Never a flag, never a file this tool writes.
- **Nothing sensitive is logged.** Credentials are stripped from every line on the way to
  the console and to the run log — a last line of defence, since Playwright errors quote
  URLs and selectors we did not compose. Session cookies and tokens are never read out of
  the browser at all, and the downloaded JSON is never printed: only its byte count is.
- **`incoming/`, `run-log.csv`, and `.env` are gitignored.** Real pipeline data does not
  belong in git history. Check before you commit anything from this directory.
- **https.** Plain http is allowed for an internal host, but the tool warns, because the
  login goes out in clear.
- **Watch the first runs.** The browser is visible by default. `--headless` is for when
  you already trust the selectors.
- **The dashboard is treated as read-only.** This tool signs in and downloads. It clicks
  nothing that changes state, and it should stay that way.

## Development

```bash
npm test          # unit tests
npm run typecheck
```

The tests cover the pure layer, which is where the decisions live: filename construction
and path containment (`naming.ts`), run-log formatting and CSV escaping (`run-log.ts`),
argument parsing (`args.ts`), the retry rule (`errors.ts`), credential redaction
(`logging.ts`), and environment reading (`env.ts`).

`browser.ts` is not unit-tested. It needs a real dashboard, and a mock of a site nobody
has seen would assert only that the mock matches the code. Exercise it by hand once the
selectors are filled in.

Sources run through Node's built-in TypeScript support (Node 23.6+), so there is no build
step and no bundler. Relative imports carry the `.ts` extension because Node requires it.

| File | |
| --- | --- |
| `src/cli.ts` | Entry point: parse, check, download once, record, exit. |
| `src/args.ts` | Command-line parsing and validation. |
| `src/env.ts` | Reads and validates the three environment variables. |
| `src/selectors.ts` | **Site configuration. All placeholders.** |
| `src/browser.ts` | The Playwright flow. |
| `src/naming.ts` | Filenames and path containment. |
| `src/run-log.ts` | CSV run log. |
| `src/errors.ts` | Error categories and the retry rule. |
| `src/logging.ts` | Redaction and truncation. |
| `src/paths.ts` | Where the tool writes. |
