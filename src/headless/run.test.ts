import { describe, expect, it } from "vitest";
import { PROFILES } from "../profiles";
import { resolveEffectiveProfile } from "../profiles/resolve";
import bellinghamCandidate from "../test/fixtures/bellingham-candidate.json";
import bellinghamReference from "../test/fixtures/bellingham-reference.json";
import nashvilleCandidate from "../test/fixtures/nashville-candidate.json";
import nashvilleReference from "../test/fixtures/nashville-reference.json";
import { detectSourceProfile } from "../profiles/detect";
import tinyBaseline from "../test/fixtures/baseline.json";
import { runHeadlessAnalysis } from "./run";

const texts: Record<string, string> = {
  "bellingham-reference.json": JSON.stringify(bellinghamReference),
  "bellingham-candidate.json": JSON.stringify(bellinghamCandidate),
  "baseline.json": JSON.stringify(tinyBaseline),
  "nashville-reference.json": JSON.stringify(nashvilleReference),
  "nashville-candidate.json": JSON.stringify(nashvilleCandidate)
};
const read = (name: string) => texts[name]!;

const bellingham = resolveEffectiveProfile(PROFILES["bellingham-procureware"]!, null).profile;

function bellinghamRun(generatedAt = "2026-08-15T00:00:00.000Z") {
  return runHeadlessAnalysis({
    baselineText: read("bellingham-reference.json"),
    latestText: read("bellingham-candidate.json"),
    baselineFileName: "bellingham-reference.json",
    latestFileName: "bellingham-candidate.json",
    profile: bellingham,
    generatedAt
  });
}

describe("headless run", () => {
  it("produces the full artifact bundle and quarantines the Bellingham regression", async () => {
    const run = await bellinghamRun();

    expect(run.analysis.summary.qualityGate).toBe("Quarantined");
    expect(run.failures.some((reason) => reason.includes("Quarantined"))).toBe(true);
    // Match rate passes the floor and no critical findings block, so all five
    // artifacts build — same as the browser's zero-decision run.
    expect(run.bundle.gate.recoveredExportAllowed).toBe(true);
    expect(run.bundle.artifacts.map((artifact) => artifact.kind)).toEqual([
      "recovered",
      "quality-report",
      "recovery-audit",
      "findings",
      "contractor-ticket"
    ]);
    expect(run.review.inputHashes.every((hash) => hash.sha256 !== null)).toBe(true);
  });

  it("is deterministic for a fixed generatedAt", async () => {
    const [first, second] = await Promise.all([bellinghamRun(), bellinghamRun()]);
    expect(first.bundle.artifacts).toEqual(second.bundle.artifacts);
  });

  it("blocks the recovered export when nothing matches", async () => {
    const run = await runHeadlessAnalysis({
      baselineText: read("baseline.json"),
      latestText: JSON.stringify({
        Refreshed: "2024-02-15T08:00:00Z",
        Export: [{ ProjectCode: "ZZ-9001", Title: "Unrelated", BidURL: "https://example.gov/zz" }]
      }),
      baselineFileName: "baseline.json",
      latestFileName: "mismatch.json",
      profile: bellingham,
      generatedAt: "2026-08-15T00:00:00.000Z"
    });

    expect(run.bundle.gate.recoveredExportAllowed).toBe(false);
    expect(run.failures.some((reason) => reason.includes("blocked"))).toBe(true);
    expect(run.bundle.blocked.map((entry) => entry.kind)).toEqual(["recovered"]);
    // Reports and audits still build, so a blocked run keeps its evidence.
    expect(run.bundle.artifacts.map((artifact) => artifact.kind)).toContain("quality-report");
  });

  it("names the offending file on a parse failure", async () => {
    await expect(
      runHeadlessAnalysis({
        baselineText: read("baseline.json"),
        latestText: "{ broken",
        baselineFileName: "baseline.json",
        latestFileName: "broken.json",
        profile: bellingham
      })
    ).rejects.toThrow(/broken\.json/);
  });
});

describe("headless run on a second real source (Nashville, no BidURL)", () => {
  // Anonymised 40-record slice of the 2026-08-27/28 Nashville pair. Every
  // BidURL is "", so this source keys on ProjectCode alone — the profile must
  // neither require BidURL nor fail to match on it.
  it("detects the profile by bot identity and matches every record on ProjectCode", async () => {
    const detection = detectSourceProfile(nashvilleCandidate, Object.values(PROFILES));
    expect(detection.status).toBe("match");
    if (detection.status === "match") {
      expect(detection.match.profileId).toBe("nashville-oracle-cloud");
      expect(detection.match.method).toBe("identity");
    }

    const nashville = resolveEffectiveProfile(PROFILES["nashville-oracle-cloud"]!, null).profile;
    expect(nashville.safeBackfillFields).toEqual([]);
    const run = await runHeadlessAnalysis({
      baselineText: read("nashville-reference.json"),
      latestText: read("nashville-candidate.json"),
      baselineFileName: "nashville-reference.json",
      latestFileName: "nashville-candidate.json",
      profile: nashville,
      generatedAt: "2026-09-02T00:00:00.000Z"
    });

    expect(run.review.match.primaryKey).toEqual(["AgentID", "ProjectCode"]);
    expect(run.review.match.matchRate).toBe(1);
    expect(run.review.match.meetsMinimumMatchRate).toBe(true);
    const categories = new Set(run.review.qa.findings.map((finding) => finding.category));
    expect(categories.has("identity_match_issue")).toBe(false);
    expect(categories.has("required_field_missing")).toBe(false);
    expect(categories.has("duplicate_identity_key")).toBe(false);
    expect(run.analysis.summary.qualityGate).toBe("Pass");
    expect(run.bundle.gate.recoveredExportAllowed).toBe(true);
    // Unapproved profile: nothing is backfilled, whatever the drift.
    expect(run.review.recovery.summary.backfilledFieldCount).toBe(0);
    expect(run.review.recovery.summary.backfillableFields).toEqual([]);
  });
});
