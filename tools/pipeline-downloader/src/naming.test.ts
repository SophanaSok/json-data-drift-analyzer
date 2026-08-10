import { describe, expect, it } from "vitest";
import { DownloadError } from "./errors.ts";
import {
  buildDownloadFilename,
  canonicalizeRunTimestamp,
  isExportKind,
  isValidBotId,
  resolveDownloadPath
} from "./naming.ts";

describe("isValidBotId", () => {
  it("accepts the shapes a bot id is expected to take", () => {
    expect(isValidBotId("lambda")).toBe(true);
    expect(isValidBotId("bellingham-wa")).toBe(true);
    expect(isValidBotId("bot_042")).toBe(true);
    expect(isValidBotId("v1.2")).toBe(true);
  });

  it("rejects anything that would change where the file lands", () => {
    expect(isValidBotId("../etc/passwd")).toBe(false);
    expect(isValidBotId("a/b")).toBe(false);
    expect(isValidBotId("a\\b")).toBe(false);
    expect(isValidBotId("..")).toBe(false);
    expect(isValidBotId(".hidden")).toBe(false);
    expect(isValidBotId("")).toBe(false);
    expect(isValidBotId("a".repeat(65))).toBe(false);
  });
});

describe("canonicalizeRunTimestamp", () => {
  it("keeps the same input mapping to the same token", () => {
    expect(canonicalizeRunTimestamp("2026-07-15 08:02:12")).toBe("2026-07-15-08-02-12");
    expect(canonicalizeRunTimestamp("2026-07-15 08:02:12")).toBe(canonicalizeRunTimestamp(" 2026-07-15 08:02:12 "));
  });

  it("preserves ISO markers rather than reformatting the date", () => {
    expect(canonicalizeRunTimestamp("2026-07-15T08:02:12Z")).toBe("2026-07-15T08-02-12Z");
  });

  it("strips separators that would break out of the download directory", () => {
    expect(canonicalizeRunTimestamp("../../2026")).toBe("2026");
    expect(canonicalizeRunTimestamp("run/2026")).toBe("run-2026");
  });

  it("rejects a timestamp with nothing usable in it", () => {
    expect(() => canonicalizeRunTimestamp("///")).toThrow(DownloadError);
    expect(() => canonicalizeRunTimestamp("  ")).toThrow(/no usable characters/);
  });

  it("does not leave a trailing separator after truncating a long value", () => {
    const canonical = canonicalizeRunTimestamp(`${"9".repeat(63)}:::::tail`);
    expect(canonical.length).toBeLessThanOrEqual(64);
    expect(canonical.endsWith("-")).toBe(false);
  });
});

describe("buildDownloadFilename", () => {
  it("produces {bot-id}_{run-timestamp}_{kind}.json", () => {
    expect(buildDownloadFilename({ botId: "lambda", runTimestamp: "2026-07-15 08:02:12", kind: "candidate" })).toBe(
      "lambda_2026-07-15-08-02-12_candidate.json"
    );
    expect(buildDownloadFilename({ botId: "lambda", runTimestamp: "2026-07-14 19:49:20", kind: "reference" })).toBe(
      "lambda_2026-07-14-19-49-20_reference.json"
    );
  });

  it("is deterministic for the same run", () => {
    const input = { botId: "lambda", runTimestamp: "2026-07-15 08:02:12", kind: "candidate" } as const;
    expect(buildDownloadFilename(input)).toBe(buildDownloadFilename(input));
  });

  it("refuses an unresolved 'latest', which would collide across runs", () => {
    expect(() => buildDownloadFilename({ botId: "lambda", runTimestamp: "latest", kind: "candidate" })).toThrow(
      /still "latest"/
    );
    expect(() => buildDownloadFilename({ botId: "lambda", runTimestamp: "LATEST", kind: "candidate" })).toThrow(
      DownloadError
    );
  });

  it("refuses a bot id that could not appear in a filename", () => {
    expect(() => buildDownloadFilename({ botId: "../evil", runTimestamp: "2026-07-15", kind: "candidate" })).toThrow(
      DownloadError
    );
  });
});

describe("resolveDownloadPath", () => {
  it("places the file inside the download directory", () => {
    expect(resolveDownloadPath("/tmp/incoming", "lambda_2026_candidate.json")).toBe(
      "/tmp/incoming/lambda_2026_candidate.json"
    );
  });

  it("refuses a name that climbs out of it", () => {
    expect(() => resolveDownloadPath("/tmp/incoming", "../escaped.json")).toThrow(/outside the download directory/);
    expect(() => resolveDownloadPath("/tmp/incoming", "nested/file.json")).toThrow(DownloadError);
    expect(() => resolveDownloadPath("/tmp/incoming", "/etc/passwd")).toThrow(DownloadError);
  });
});

describe("isExportKind", () => {
  it("admits only the two kinds", () => {
    expect(isExportKind("candidate")).toBe(true);
    expect(isExportKind("reference")).toBe(true);
    expect(isExportKind("baseline")).toBe(false);
    expect(isExportKind("")).toBe(false);
  });
});
