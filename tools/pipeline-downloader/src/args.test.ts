import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.ts";

const required = ["--bot-id", "lambda", "--run", "latest", "--kind", "candidate"];

function parseOk(argv: string[]) {
  const result = parseArgs(argv);
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  return result.args;
}

function parseError(argv: string[]): string {
  const result = parseArgs(argv);
  if (result.status !== "error") throw new Error(`expected error, got ${result.status}`);
  return result.message;
}

describe("parseArgs", () => {
  it("reads the documented command", () => {
    expect(parseOk(required)).toEqual({
      botId: "lambda",
      requestedRun: "latest",
      kind: "candidate",
      headless: false,
      overwrite: false,
      dryRun: false
    });
  });

  it("defaults to a visible browser", () => {
    expect(parseOk(required).headless).toBe(false);
    expect(parseOk([...required, "--headless"]).headless).toBe(true);
  });

  it("accepts --flag=value as well as --flag value", () => {
    const args = parseOk(["--bot-id=lambda", "--run=2026-07-15 08:02:12", "--kind=reference"]);
    expect(args.botId).toBe("lambda");
    expect(args.requestedRun).toBe("2026-07-15 08:02:12");
    expect(args.kind).toBe("reference");
  });

  it("reports --help before anything else", () => {
    expect(parseArgs(["--help"]).status).toBe("help");
    expect(parseArgs([...required, "--help"]).status).toBe("help");
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    // A silently ignored `--bot_id` would download some other bot's export under a
    // filename claiming otherwise.
    expect(parseError([...required, "--bot_id", "other"])).toMatch(/Unknown argument/);
  });

  it("names every missing required flag", () => {
    const message = parseError(["--kind", "candidate"]);
    expect(message).toContain("--bot-id");
    expect(message).toContain("--run");
  });

  it("rejects a flag given twice", () => {
    expect(parseError([...required, "--kind", "reference"])).toMatch(/more than once/);
  });

  it("rejects a value flag with no value", () => {
    expect(parseError(["--bot-id", "--run", "latest", "--kind", "candidate"])).toMatch(/--bot-id needs a value/);
    expect(parseError(["--bot-id", "lambda", "--run", "latest", "--kind"])).toMatch(/--kind needs a value/);
  });

  it("rejects a boolean flag given a value", () => {
    expect(parseError([...required, "--headless=true"])).toMatch(/does not take a value/);
  });

  it("rejects a kind that is not one of the two exports", () => {
    expect(parseError(["--bot-id", "lambda", "--run", "latest", "--kind", "baseline"])).toMatch(/must be "candidate"/);
  });

  it("rejects a bot id that is not filename-safe", () => {
    expect(parseError(["--bot-id", "../etc", "--run", "latest", "--kind", "candidate"])).toMatch(/not usable/);
  });

  it("accepts a run timestamp but rejects one with no digits", () => {
    expect(parseOk(["--bot-id", "lambda", "--run", "2026-07-15 08:02:12", "--kind", "candidate"]).requestedRun).toBe(
      "2026-07-15 08:02:12"
    );
    expect(parseError(["--bot-id", "lambda", "--run", "newest", "--kind", "candidate"])).toMatch(/no digits/);
  });
});
