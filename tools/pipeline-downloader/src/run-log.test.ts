import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendRunLogEntry, formatCsvField, formatRunLogRow, runLogHeader, type RunLogEntry } from "./run-log.ts";

const baseEntry: RunLogEntry = {
  timestamp: "2026-08-10T09:15:00.000Z",
  botId: "lambda",
  requestedRun: "latest",
  resolvedRun: "2026-07-15-08-02-12",
  filePath: "incoming/lambda_2026-07-15-08-02-12_candidate.json",
  outcome: "success",
  errorCategory: "",
  message: ""
};

const temporaryDirectories: string[] = [];

async function temporaryLogPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-downloader-test-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "run-log.csv");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("formatCsvField", () => {
  it("leaves ordinary values alone", () => {
    expect(formatCsvField("lambda")).toBe("lambda");
    expect(formatCsvField("2026-07-15-08-02-12")).toBe("2026-07-15-08-02-12");
    expect(formatCsvField("")).toBe("");
  });

  it("quotes commas and doubles embedded quotes", () => {
    expect(formatCsvField("a,b")).toBe('"a,b"');
    expect(formatCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("flattens newlines so one entry stays one row", () => {
    expect(formatCsvField("line one\nline two")).toBe("line one line two");
    expect(formatCsvField("carriage\r\nreturn")).toBe("carriage return");
  });

  it("neutralizes values a spreadsheet would execute as a formula", () => {
    expect(formatCsvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(formatCsvField("+1")).toBe("'+1");
    expect(formatCsvField("-1")).toBe("'-1");
    expect(formatCsvField("@run")).toBe("'@run");
  });
});

describe("formatRunLogRow", () => {
  it("writes the columns in header order", () => {
    expect(runLogHeader()).toBe("timestamp,bot_id,requested_run,resolved_run,file_path,outcome,error_category,message");
    // Trailing empty fields are error_category and message: a success has neither.
    expect(formatRunLogRow(baseEntry)).toBe(
      "2026-08-10T09:15:00.000Z,lambda,latest,2026-07-15-08-02-12,incoming/lambda_2026-07-15-08-02-12_candidate.json,success,,"
    );
  });

  it("records a failure with its category", () => {
    const row = formatRunLogRow({
      ...baseEntry,
      resolvedRun: "",
      filePath: "",
      outcome: "failure",
      errorCategory: "download_timeout",
      message: "The candidate export did not start within 60s."
    });

    expect(row).toBe(
      "2026-08-10T09:15:00.000Z,lambda,latest,,,failure,download_timeout,The candidate export did not start within 60s."
    );
  });

  it("keeps a long message from running away with the file", () => {
    const row = formatRunLogRow({ ...baseEntry, message: "x".repeat(500) });
    expect(row.length).toBeLessThan(400);
  });

  it("produces one line per entry even when a message spans several", () => {
    const row = formatRunLogRow({ ...baseEntry, message: "first\nsecond\nthird" });
    expect(row.includes("\n")).toBe(false);
  });
});

describe("appendRunLogEntry", () => {
  it("writes a header once and appends afterwards", async () => {
    const logPath = await temporaryLogPath();

    expect(await appendRunLogEntry(logPath, baseEntry)).toBe(true);
    expect(await appendRunLogEntry(logPath, { ...baseEntry, outcome: "failure", errorCategory: "auth" })).toBe(true);

    const lines = (await fs.readFile(logPath, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(runLogHeader());
    expect(lines[1]).toContain("success");
    expect(lines[2]).toContain("auth");
  });

  it("reports rather than throws when the log cannot be written", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-downloader-test-"));
    temporaryDirectories.push(directory);
    // A directory where the file should be: writable path, unwritable target.
    const logPath = path.join(directory, "run-log.csv");
    await fs.mkdir(logPath);

    expect(await appendRunLogEntry(logPath, baseEntry)).toBe(false);
  });
});
