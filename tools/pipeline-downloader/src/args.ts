/**
 * Command-line parsing.
 *
 * Unknown flags are an error rather than something to ignore. A typo like `--bot_id`
 * silently ignored would download the wrong bot's export under a name that claims
 * otherwise, and the whole point of this tool is that the file on disk means what its
 * name says.
 *
 * Parsing returns a result instead of throwing so the caller decides how a bad command
 * line is presented, and so the tests read as assertions rather than try/catch.
 */

import { isExportKind, isValidBotId, type ExportKind } from "./naming.ts";

export type ParsedArgs = {
  botId: string;
  /** "latest" means "resolve the newest run from the dashboard". */
  requestedRun: string;
  kind: ExportKind;
  /** Visible browser unless `--headless` was passed. */
  headless: boolean;
  /** Allow replacing an already-downloaded file. */
  overwrite: boolean;
  /** Validate configuration and report the plan without opening a browser. */
  dryRun: boolean;
};

export type ParseResult =
  | { status: "ok"; args: ParsedArgs }
  | { status: "help" }
  | { status: "error"; message: string };

const BOOLEAN_FLAGS = ["--headless", "--overwrite", "--dry-run"] as const;
const VALUE_FLAGS = ["--bot-id", "--run", "--kind"] as const;

export const USAGE = `pipeline-downloader — download one JSON export from the pipeline dashboard.

Usage:
  npm run download -- --bot-id <id> --run <latest|timestamp> --kind <candidate|reference>

Required:
  --bot-id <id>              Bot to download for. Letters, digits, dot, dash, underscore.
  --run <latest|timestamp>   "latest", or the run timestamp exactly as the dashboard shows it.
  --kind <candidate|reference>  Which export of that run to download.

Optional:
  --headless                 Run without a visible browser. Default is visible, for debugging.
  --overwrite                Replace an already-downloaded file instead of stopping.
  --dry-run                  Check arguments, environment, and selectors; download nothing.
  --help                     Show this message.

Credentials come from the environment only: PIPELINE_DASHBOARD_URL, PIPELINE_USERNAME,
PIPELINE_PASSWORD. See README.md.`;

function missingValue(flag: string): string {
  return `${flag} needs a value.`;
}

export function parseArgs(argv: string[]): ParseResult {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") return { status: "help" };

    // Both `--flag value` and `--flag=value` are accepted; npm users reach for either.
    const separator = token.indexOf("=");
    const name = separator === -1 ? token : token.slice(0, separator);
    const inlineValue = separator === -1 ? null : token.slice(separator + 1);

    if ((BOOLEAN_FLAGS as readonly string[]).includes(name)) {
      if (inlineValue !== null) return { status: "error", message: `${name} does not take a value.` };
      flags.add(name);
      continue;
    }

    if ((VALUE_FLAGS as readonly string[]).includes(name)) {
      const value = inlineValue ?? argv[index + 1];
      if (value === undefined || value.startsWith("--")) return { status: "error", message: missingValue(name) };
      if (inlineValue === null) index += 1;
      if (values.has(name)) return { status: "error", message: `${name} was given more than once.` };
      values.set(name, value);
      continue;
    }

    return { status: "error", message: `Unknown argument "${token}". Run with --help.` };
  }

  const botId = values.get("--bot-id")?.trim() ?? "";
  const requestedRun = values.get("--run")?.trim() ?? "";
  const kind = values.get("--kind")?.trim() ?? "";

  const missing = [
    botId.length === 0 ? "--bot-id" : null,
    requestedRun.length === 0 ? "--run" : null,
    kind.length === 0 ? "--kind" : null
  ].filter((flag): flag is string => flag !== null);

  if (missing.length > 0) {
    return { status: "error", message: `Missing required ${missing.join(", ")}. Run with --help.` };
  }

  if (!isValidBotId(botId)) {
    return {
      status: "error",
      message: `--bot-id "${botId}" is not usable in a filename. Use letters, digits, dot, dash, or underscore.`
    };
  }

  if (!isExportKind(kind)) {
    return { status: "error", message: `--kind must be "candidate" or "reference", not "${kind}".` };
  }

  // The dashboard's timestamp format is unknown, so anything non-empty is accepted here
  // and matched against the dashboard later. A value with no digit is almost certainly a
  // mistake — most likely a shell that ate the real argument.
  if (requestedRun !== "latest" && !/\d/.test(requestedRun)) {
    return {
      status: "error",
      message: `--run must be "latest" or a run timestamp; "${requestedRun}" contains no digits.`
    };
  }

  return {
    status: "ok",
    args: {
      botId,
      requestedRun,
      kind,
      headless: flags.has("--headless"),
      overwrite: flags.has("--overwrite"),
      dryRun: flags.has("--dry-run")
    }
  };
}
