/**
 * The browser side: sign in, find the run, download one export.
 *
 * Playwright rather than an LLM browser agent. The steps here are fixed and few, and a
 * model deciding at runtime which button looks like "download" is both slower and
 * unaccountable — when a wrong file lands on disk there is nothing to read afterwards
 * that explains why. A selector that breaks fails loudly at a known line.
 *
 * Every selector this file uses lives in `src/selectors.ts`, and all of them are still
 * placeholders. `assertSelectorsConfigured` refuses to launch a browser until they are
 * filled in, so nothing below has ever run against a real dashboard.
 *
 * The session is deliberately disposable: a fresh context per run, `storageState` never
 * saved, browser closed in a `finally`. Nothing about the login survives the process.
 */

import fs from "node:fs/promises";
import { chromium, type BrowserContext, type Download, type Locator, type Page } from "playwright";
import { DownloadError, retryOnDownloadTimeout, toDownloadError, type ErrorCategory } from "./errors.ts";
import type { PipelineEnv } from "./env.ts";
import { summarizeDetail, type Logger } from "./logging.ts";
import { buildDownloadFilename, resolveDownloadPath, type ExportKind } from "./naming.ts";
import { relativeToTool } from "./paths.ts";
import { assertSelectorsConfigured, fillTemplate, isConfigured, selectorConfig } from "./selectors.ts";

const NAVIGATION_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 15_000;
const LOGIN_TIMEOUT_MS = 30_000;

/** How long to wait for the export to start arriving before calling it a timeout. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Above this size the payload is spot-checked rather than fully parsed. */
const MAX_PARSE_BYTES = 128 * 1024 * 1024;

export type DownloadRequest = {
  botId: string;
  /** "latest" or a run timestamp as the dashboard shows it. */
  requestedRun: string;
  kind: ExportKind;
  headless: boolean;
  overwrite: boolean;
  incomingDir: string;
};

export type DownloadOutcome = {
  /** The concrete run timestamp read from the page. */
  resolvedRun: string;
  filePath: string;
  bytes: number;
  /** 1 unless a download timed out and was retried. */
  attempts: number;
};

/** Playwright signals every timeout through this name, whatever the operation was. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Wrap a Playwright failure in a category.
 *
 * The original message is truncated on the way in. Playwright's timeout reports are
 * multi-line and can quote page content, and neither belongs in a one-line summary or a
 * CSV cell.
 */
function fail(category: ErrorCategory, context: string, error: unknown): DownloadError {
  return new DownloadError(category, `${context} ${summarizeDetail(asError(error).message)}`.trim());
}

async function signIn(page: Page, env: PipelineEnv): Promise<void> {
  const loginUrl = `${env.baseUrl}${selectorConfig.loginPath}`;

  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  } catch (error) {
    throw fail("navigation", "Could not open the login page.", error);
  }

  try {
    await page.locator(selectorConfig.usernameField).fill(env.username, { timeout: ACTION_TIMEOUT_MS });
    await page.locator(selectorConfig.passwordField).fill(env.password, { timeout: ACTION_TIMEOUT_MS });
    await page.locator(selectorConfig.submitButton).click({ timeout: ACTION_TIMEOUT_MS });
  } catch (error) {
    // The form is not where the selectors say it is. That is a configuration or layout
    // problem, not a rejected password, so it is not reported as an auth failure.
    throw fail("navigation", "The login form did not match the configured selectors.", error);
  }

  // Both waits are given a resolved outcome rather than left to reject, so whichever
  // loses the race cannot surface later as an unhandled rejection.
  const signedIn = page
    .locator(selectorConfig.loggedInMarker)
    .waitFor({ state: "visible", timeout: LOGIN_TIMEOUT_MS })
    .then(() => "signed-in" as const)
    .catch(() => "timed-out" as const);

  const outcome = isConfigured(selectorConfig.loginErrorMarker)
    ? await Promise.race([
        signedIn,
        page
          .locator(selectorConfig.loginErrorMarker)
          .waitFor({ state: "visible", timeout: LOGIN_TIMEOUT_MS })
          .then(() => "rejected" as const)
          .catch(() => "timed-out" as const)
      ])
    : await signedIn;

  if (outcome === "rejected") {
    throw new DownloadError("auth", "The dashboard rejected the credentials in PIPELINE_USERNAME/PIPELINE_PASSWORD.");
  }
  if (outcome === "timed-out") {
    throw new DownloadError(
      "auth",
      "Login did not complete: the signed-in marker never appeared. The credentials may be wrong, or the dashboard may require a second factor this tool does not handle."
    );
  }
}

async function openRunList(page: Page, env: PipelineEnv, botId: string): Promise<void> {
  const runsUrl = `${env.baseUrl}${fillTemplate(selectorConfig.runsPath, { botId })}`;

  try {
    await page.goto(runsUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
  } catch (error) {
    throw fail("navigation", `Could not open the run list for bot "${botId}".`, error);
  }
}

/**
 * Find the requested run and read back the timestamp the dashboard shows for it.
 *
 * The timestamp always comes from the page, even when the caller named one explicitly.
 * The filename is then derived from what the dashboard actually displays, so the same
 * run downloaded via `latest` and via an explicit timestamp produces the same file.
 */
async function locateRun(page: Page, requestedRun: string): Promise<{ row: Locator; resolvedRun: string }> {
  const wantsLatest = requestedRun === "latest";
  const rowSelector = wantsLatest
    ? selectorConfig.latestRunRow
    : fillTemplate(selectorConfig.runRow, { runTimestamp: requestedRun });

  const row = page.locator(rowSelector).first();

  try {
    await row.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
  } catch (error) {
    throw fail(
      "run_not_found",
      wantsLatest ? "No runs are listed for that bot." : `Run "${requestedRun}" is not listed for that bot.`,
      error
    );
  }

  let resolvedRun: string;
  try {
    resolvedRun = (await row.locator(selectorConfig.runTimestampCell).first().innerText()).trim();
  } catch (error) {
    throw fail("navigation", "Found the run row but could not read its timestamp.", error);
  }

  if (resolvedRun.length === 0) {
    throw new DownloadError("navigation", "The run row's timestamp cell is empty; check runTimestampCell.");
  }

  return { row, resolvedRun };
}

/**
 * Click the export control and wait for the download to start.
 *
 * Retried by the caller on timeout only. Re-clicking is safe here in a way that
 * re-sending a write would not be: this triggers an export the dashboard already holds,
 * so a duplicate attempt costs a duplicate read. If a dashboard ever queues a *new*
 * export job on this click, the retry becomes a second job and this comment stops being
 * true — check that before filling in `downloadControl`.
 */
async function startDownload(page: Page, row: Locator, kind: ExportKind): Promise<Download> {
  const control = row.locator(selectorConfig.downloadControl[kind]).first();

  // Listen before clicking: the download can begin before click() resolves.
  const pending = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
  const settled: Promise<Download | Error> = pending.catch((error: unknown) => asError(error));

  try {
    await control.click({ timeout: ACTION_TIMEOUT_MS });
  } catch (error) {
    // `settled` is deliberately not awaited: it has its own catch, so it cannot surface
    // as an unhandled rejection, and waiting for it would stall a failed click behind
    // the full download timeout.
    throw fail("download_failed", `Could not click the ${kind} download control.`, error);
  }

  const outcome = await settled;
  if (outcome instanceof Error) {
    throw isTimeout(outcome)
      ? new DownloadError(
          "download_timeout",
          `The ${kind} export did not start within ${DOWNLOAD_TIMEOUT_MS / 1000}s.`
        )
      : fail("download_failed", `The ${kind} export failed to start.`, outcome);
  }
  return outcome;
}

/**
 * Write the download to a temporary file next to its destination.
 *
 * Saving under the final name directly would leave a half-written file behind if the
 * transfer dies mid-stream, and the next tool to read `incoming/` would parse garbage
 * from a file whose name promises a complete export.
 */
async function saveDownload(download: Download, targetPath: string): Promise<string> {
  const partialPath = `${targetPath}.partial`;

  try {
    await download.saveAs(partialPath);
  } catch (error) {
    await fs.rm(partialPath, { force: true });
    throw isTimeout(error)
      ? new DownloadError("download_timeout", "The export stopped partway through.")
      : fail("download_failed", "The export could not be written.", error);
  }

  return partialPath;
}

/**
 * Confirm the file is JSON before it takes the final name.
 *
 * A dashboard that answers an expired session with an HTML login page returns a
 * perfectly successful download of the wrong thing; without this check that page lands
 * in `incoming/` named as an export.
 *
 * Nothing parsed here is logged — only the byte count leaves this function.
 */
async function validateJsonPayload(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  if (stats.size === 0) {
    throw new DownloadError("invalid_payload", "The downloaded file is empty.");
  }

  const contents = await fs.readFile(filePath, "utf8");
  // Real scraper exports ship with a UTF-8 BOM, which JSON.parse rejects outright.
  const text = contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents;
  const firstCharacter = text.trimStart()[0];

  if (firstCharacter !== "{" && firstCharacter !== "[") {
    throw new DownloadError(
      "invalid_payload",
      "The downloaded file does not start like JSON. The session may have expired and returned an HTML page."
    );
  }

  if (stats.size <= MAX_PARSE_BYTES) {
    try {
      JSON.parse(text);
    } catch {
      // The parser's message quotes the offending input, so it is not passed on.
      throw new DownloadError("invalid_payload", "The downloaded file is not valid JSON.");
    }
  }

  return stats.size;
}

async function assertWritable(targetPath: string, overwrite: boolean): Promise<void> {
  const existing = await fs.stat(targetPath).catch(() => null);
  if (existing === null) return;

  if (!overwrite) {
    throw new DownloadError(
      "filesystem",
      `${relativeToTool(targetPath)} already exists. Pass --overwrite to replace it, or delete it first.`
    );
  }
}

/**
 * Run the whole flow once.
 *
 * @throws DownloadError always categorized; the caller records it and exits
 */
export async function downloadExport(
  request: DownloadRequest,
  env: PipelineEnv,
  logger: Logger
): Promise<DownloadOutcome> {
  assertSelectorsConfigured();

  await fs.mkdir(request.incomingDir, { recursive: true }).catch((error: unknown) => {
    throw fail("filesystem", "Could not create the download directory.", error);
  });

  const browser = await chromium.launch({ headless: request.headless }).catch((error: unknown) => {
    throw fail("config", "Could not launch Chromium. Run `npx playwright install chromium`.", error);
  });

  let context: BrowserContext | null = null;

  try {
    // No storageState in and none saved out: the session lasts exactly this long.
    context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();

    logger.info("Signing in…");
    await signIn(page, env);

    logger.info(`Opening runs for bot ${request.botId}…`);
    await openRunList(page, env, request.botId);

    const { row, resolvedRun } = await locateRun(page, request.requestedRun);
    logger.info(`Run: ${resolvedRun}`);

    try {
      const filename = buildDownloadFilename({ botId: request.botId, runTimestamp: resolvedRun, kind: request.kind });
      const targetPath = resolveDownloadPath(request.incomingDir, filename);
      await assertWritable(targetPath, request.overwrite);

      const { value: partialPath, attempts } = await retryOnDownloadTimeout(async (attempt) => {
        if (attempt > 1) logger.warn(`Download timed out. Retrying (attempt ${attempt})…`);
        const download = await startDownload(page, row, request.kind);
        return saveDownload(download, targetPath);
      });

      let bytes: number;
      try {
        bytes = await validateJsonPayload(partialPath);
      } catch (error) {
        await fs.rm(partialPath, { force: true });
        throw toDownloadError(error);
      }

      try {
        await fs.rename(partialPath, targetPath);
      } catch (error) {
        await fs.rm(partialPath, { force: true });
        throw fail("filesystem", "Could not move the download into place.", error);
      }

      return { resolvedRun, filePath: targetPath, bytes, attempts };
    } catch (error) {
      // Past this point the run is known, so the failure can say which one it was.
      const failure = toDownloadError(error);
      failure.resolvedRun = resolvedRun;
      throw failure;
    }
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
