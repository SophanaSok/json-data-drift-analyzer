import { describe, expect, it } from "vitest";
import { assessFileOrderFromJson } from "./file-order";
import referenceRaw from "../test/fixtures/bellingham-reference.json?raw";
import candidateRaw from "../test/fixtures/bellingham-candidate.json?raw";

const withDates = (refreshed: string, created: string) =>
  JSON.stringify({ Export: [{ Refreshed: refreshed, Created: created, ProjectCode: "1B-2020" }] });

describe("assessFileOrderFromJson", () => {
  it("parses input carrying a UTF-8 BOM", () => {
    // Regression guard: real scraper exports ship with a BOM, and a bare
    // JSON.parse rejects them. See docs/forensic-bellingham-report.md.
    const baseline = "﻿" + withDates("2026-07-14 21:48:33", "2026-07-14 21:48:33");
    const latest = "﻿" + withDates("2026-07-15 10:01:07", "2026-07-15 10:01:07");

    expect(() => assessFileOrderFromJson(baseline, latest, "baseline.json", "latest.json")).not.toThrow();

    const assessment = assessFileOrderFromJson(baseline, latest, "baseline.json", "latest.json");
    expect(assessment.status).toBe("correct");
    expect(assessment.baseline.dates.Refreshed).toBe("2026-07-14 21:48:33");
    expect(assessment.latest.dates.Refreshed).toBe("2026-07-15 10:01:07");
  });

  it("handles the real BOM-carrying exports end to end", () => {
    const assessment = assessFileOrderFromJson(
      referenceRaw,
      candidateRaw,
      "lambda-20260714-reference.json",
      "lambda-20260715-candidate.json"
    );

    expect(assessment.status).toBe("correct");
    expect(assessment.baseline.dates.Refreshed).toBe("2026-07-14 21:48:33");
    expect(assessment.latest.dates.Refreshed).toBe("2026-07-15 10:01:07");
    expect(assessment.issues).toHaveLength(0);
  });

  it("still detects reversed export order through a BOM", () => {
    const baseline = "﻿" + withDates("2026-07-15 10:01:07", "2026-07-15 10:01:07");
    const latest = "﻿" + withDates("2026-07-14 21:48:33", "2026-07-14 21:48:33");

    const assessment = assessFileOrderFromJson(baseline, latest, "baseline.json", "latest.json");

    expect(assessment.status).toBe("reversed");
    expect(assessment.issues.length).toBeGreaterThan(0);
  });

  it("still throws on genuinely malformed JSON", () => {
    expect(() => assessFileOrderFromJson('{"Export": nope}', "{}", "bad.json", "ok.json")).toThrow();
    expect(() => assessFileOrderFromJson('﻿{"Export": nope}', "{}", "bad.json", "ok.json")).toThrow();
  });
});
