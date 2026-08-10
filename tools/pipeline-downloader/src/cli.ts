/**
 * Entry point: parse, check, download once, record the outcome, exit.
 *
 * One run downloads one export for one bot. There is no scheduling, no fan-out across
 * bots, and no queue — the tool is driven by hand and its output is meant to be looked
 * at. Everything about growing past that is a later decision, and none of it is
 * scaffolded here.
 *
 * The run log is written for every attempt that got far enough to name a bot, including
 * failures. A history that only records successes cannot answer the question anyone
 * actually asks it, which is what keeps going wrong.
 */

import { parseArgs, USAGE, type ParsedArgs } from "./args.ts";
import { downloadExport } from "./browser.ts";
import { toDownloadError } from "./errors.ts";
import { readPipelineEnv, secretsOf, type PipelineEnv } from "./env.ts";
import { createLogger, summarizeDetail, type Logger } from "./logging.ts";
import { buildDownloadFilename } from "./naming.ts";
import { INCOMING_DIR, relativeToTool, RUN_LOG_PATH } from "./paths.ts";
import { appendRunLogEntry, type RunLogEntry } from "./run-log.ts";
import { unconfiguredSelectors } from "./selectors.ts";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function record(entry: RunLogEntry, logger: Logger): Promise<void> {
  const written = await appendRunLogEntry(RUN_LOG_PATH, entry);
  if (!written) {
    logger.warn(`Could not append to ${relativeToTool(RUN_LOG_PATH)}. The download result above still stands.`);
  }
}

/**
 * Report what a real run would do, without opening a browser or writing anything.
 *
 * This is the only way to exercise the wiring while the selectors are placeholders, and
 * it stays useful afterwards for checking which environment a shell is pointed at.
 */
function reportPlan(args: ParsedArgs, env: PipelineEnv, logger: Logger): void {
  const filename =
    args.requestedRun === "latest"
      ? `${args.botId}_<run-timestamp-from-dashboard>_${args.kind}.json`
      : buildDownloadFilename({ botId: args.botId, runTimestamp: args.requestedRun, kind: args.kind });

  const unfilled = unconfiguredSelectors();

  logger.info("Dry run — nothing was downloaded and nothing was logged.");
  logger.info(`  dashboard:  ${env.baseUrl}`);
  logger.info(`  bot:        ${args.botId}`);
  logger.info(`  run:        ${args.requestedRun}`);
  logger.info(`  kind:       ${args.kind}`);
  logger.info(`  browser:    ${args.headless ? "headless" : "visible"}`);
  logger.info(`  would save: ${relativeToTool(INCOMING_DIR)}/${filename}`);
  logger.info(`  run log:    ${relativeToTool(RUN_LOG_PATH)}`);
  logger.info(
    unfilled.length === 0
      ? "  selectors:  configured"
      : `  selectors:  ${unfilled.length} placeholder(s) still to fill in — ${unfilled.join(", ")}`
  );
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.status === "help") {
    console.log(USAGE);
    return 0;
  }

  if (parsed.status === "error") {
    console.error(parsed.message);
    return 2;
  }

  const args = parsed.args;
  const envResult = readPipelineEnv(process.env);

  // No credentials means no logger secrets yet, but also nothing sensitive to print.
  if (envResult.status === "error") {
    console.error(envResult.message);
    await record(
      {
        timestamp: new Date().toISOString(),
        botId: args.botId,
        requestedRun: args.requestedRun,
        resolvedRun: "",
        filePath: "",
        outcome: "failure",
        errorCategory: "config",
        message: envResult.message
      },
      createLogger([])
    );
    return 2;
  }

  const env = envResult.env;
  const logger = createLogger(secretsOf(env));

  if (env.insecureTransport) {
    logger.warn(`Warning: ${env.baseUrl} is plain http, so the login is sent unencrypted. Use https if it exists.`);
  }

  if (args.dryRun) {
    reportPlan(args, env, logger);
    return 0;
  }

  const startedAt = new Date().toISOString();

  try {
    const outcome = await downloadExport(
      {
        botId: args.botId,
        requestedRun: args.requestedRun,
        kind: args.kind,
        headless: args.headless,
        overwrite: args.overwrite,
        incomingDir: INCOMING_DIR
      },
      env,
      logger
    );

    logger.info(`Saved ${relativeToTool(outcome.filePath)} (${formatBytes(outcome.bytes)}).`);
    if (outcome.attempts > 1) logger.info(`Took ${outcome.attempts} attempts.`);

    await record(
      {
        timestamp: startedAt,
        botId: args.botId,
        requestedRun: args.requestedRun,
        resolvedRun: outcome.resolvedRun,
        filePath: relativeToTool(outcome.filePath),
        outcome: "success",
        errorCategory: "",
        message: outcome.attempts > 1 ? `succeeded on attempt ${outcome.attempts}` : ""
      },
      logger
    );

    return 0;
  } catch (error) {
    const failure = toDownloadError(error);
    // Redacted here as well as in the logger: this string is also written to the log file.
    const message = logger.clean(summarizeDetail(failure.message));

    logger.error(`Failed (${failure.category}): ${message}`);

    await record(
      {
        timestamp: startedAt,
        botId: args.botId,
        requestedRun: args.requestedRun,
        resolvedRun: failure.resolvedRun ?? "",
        filePath: "",
        outcome: "failure",
        errorCategory: failure.category,
        message
      },
      logger
    );

    return 1;
  }
}

process.exitCode = await main();
