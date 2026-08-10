import { describe, expect, it } from "vitest";
import {
  assertNoSecrets,
  buildContractorTicketArtifact,
  buildExportBundle,
  buildFileName,
  buildFindingsCsvArtifact,
  buildQualityReportArtifact,
  buildRecoveredArtifact,
  buildRecoveryAuditArtifact,
  downloadArtifact,
  escapeCsvCell,
  evaluateExportGate,
  hashInputFile,
  timestampSlug,
  type ExportInputs
} from "./export";
import { matchRecords } from "./matchRecords";
import { runQa } from "./qa";
import { runRecovery } from "./recovery";
import { runDedupe } from "./dedupe";
import type { SourceProfile } from "./adapter-types";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

const bellinghamProfile: SourceProfile = {
  id: "bellingham-procureware",
  version: 2,
  collectionPath: "Export",
  primaryKey: ["AgentID", "BidURL"],
  fallbackKeys: [["AgentID", "ProjectCode"]],
  dedupeKey: ["AgentID", "BidURL"],
  hardRequiredFields: ["AgentID", "ProjectCode", "BidURL"],
  safeBackfillFields: ["ContactPhone", "ContactEmail"],
  manualReviewFields: [],
  excludedFields: ["Created", "Refreshed"],
  dateSensitiveFields: ["DueDate", "PublishedDate", "AwardDate", "BidStatus", "ContractValue"],
  minimumMatchRate: 0.95
};

const genericProfile: SourceProfile = {
  id: "generic source",
  version: 4,
  collectionPath: "Records",
  primaryKey: ["Id"],
  fallbackKeys: [],
  dedupeKey: ["Id"],
  hardRequiredFields: ["Id"],
  safeBackfillFields: [],
  manualReviewFields: [],
  excludedFields: [],
  minimumMatchRate: 0
};

const rec = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ Id: "a", ...overrides });

function inputs(
  reference: Array<Record<string, unknown>>,
  candidate: Array<Record<string, unknown>>,
  profile: SourceProfile = genericProfile,
  overrides: Partial<ExportInputs> = {}
): ExportInputs {
  const matchReport = matchRecords(reference, candidate, profile);
  const qa = runQa(reference, candidate, profile, { matchReport, generatedAt: FIXED_NOW });
  const recovery = runRecovery(candidate, reference, profile, matchReport, qa.findings, {
    generatedAt: FIXED_NOW,
    sourceRun: "candidate.json",
    referenceRun: "reference.json"
  });
  const dedupe = runDedupe(recovery, candidate, profile, { generatedAt: FIXED_NOW });

  return {
    profile,
    qa,
    recovery,
    dedupe,
    generatedAt: FIXED_NOW,
    inputHashes: [
      { fileName: "candidate.json", role: "candidate", sha256: "a".repeat(64), unavailableReason: null },
      { fileName: "reference.json", role: "reference", sha256: "b".repeat(64), unavailableReason: null }
    ],
    ...overrides
  };
}

const bellinghamInputs = () => inputs(referenceRecords, candidateRecords, bellinghamProfile);

describe("export: filenames", () => {
  it("includes profile id, kind, and timestamp", () => {
    expect(buildFileName("recovered", "bellingham-procureware", FIXED_NOW)).toBe(
      "bellingham-procureware-recovered-2026-08-10T00-00-00-000Z.json"
    );
  });

  it("uses the right extension per artifact", () => {
    expect(buildFileName("findings", "p", FIXED_NOW).endsWith(".csv")).toBe(true);
    expect(buildFileName("contractor-ticket", "p", FIXED_NOW).endsWith(".md")).toBe(true);
    expect(buildFileName("quality-report", "p", FIXED_NOW).endsWith(".json")).toBe(true);
  });

  it("makes a profile id with spaces or slashes filesystem-safe", () => {
    expect(buildFileName("recovered", "generic source/v2", FIXED_NOW)).toBe(
      "generic-source-v2-recovered-2026-08-10T00-00-00-000Z.json"
    );
  });

  it("never emits a colon or dot in the timestamp", () => {
    const slug = timestampSlug(FIXED_NOW);
    expect(slug).toBe("2026-08-10T00-00-00-000Z");
    expect(slug).not.toContain(":");
  });

  it("falls back to a placeholder rather than an empty name", () => {
    expect(buildFileName("recovered", "///", FIXED_NOW)).toContain("unnamed-recovered");
  });
});

describe("export: input hashing", () => {
  it("computes a SHA-256 when SubtleCrypto is available", async () => {
    const hash = await hashInputFile("candidate.json", "candidate", '{"Export":[]}');

    expect(hash.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(hash.unavailableReason).toBeNull();
    expect(hash.role).toBe("candidate");
  });

  it("is stable for identical content and differs for different content", async () => {
    const a = await hashInputFile("a.json", "candidate", "same");
    const b = await hashInputFile("b.json", "reference", "same");
    const c = await hashInputFile("c.json", "reference", "different");

    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).not.toBe(c.sha256);
  });

  it("marks the hash unavailable rather than throwing when crypto is absent", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      const hash = await hashInputFile("candidate.json", "candidate", "x");
      expect(hash.sha256).toBeNull();
      expect(hash.unavailableReason).toContain("SubtleCrypto unavailable");
    } finally {
      if (original) Object.defineProperty(globalThis, "crypto", original);
    }
  });

  it("surfaces unavailable hashes as a warning in the quality report", () => {
    const report = buildQualityReportArtifact(
      inputs([], [rec()], genericProfile, {
        inputHashes: [
          { fileName: "candidate.json", role: "candidate", sha256: null, unavailableReason: "insecure context" }
        ]
      })
    );
    const parsed = JSON.parse(report.content);

    expect(parsed.run.hashesAvailable).toBe(false);
    expect(parsed.warnings.join(" ")).toContain("INPUT HASHES UNAVAILABLE");
  });
});

describe("export: safety gate", () => {
  const belowMinimum: SourceProfile = { ...genericProfile, minimumMatchRate: 0.95 };

  it("allows the recovered artifact when nothing is wrong", () => {
    const bundle = buildExportBundle(inputs([rec()], [rec()]));

    expect(bundle.gate.recoveredExportAllowed).toBe(true);
    expect(bundle.blocked).toHaveLength(0);
    expect(bundle.artifacts.map((a) => a.kind)).toContain("recovered");
  });

  it("blocks the recovered artifact when the match rate is below the minimum", () => {
    const bundle = buildExportBundle(inputs([rec()], [rec(), rec({ Id: "b" })], belowMinimum));

    expect(bundle.gate.recoveredExportAllowed).toBe(false);
    expect(bundle.gate.matchRateBelowMinimum).toBe(true);
    expect(bundle.blocked[0].kind).toBe("recovered");
    expect(bundle.blocked[0].reason).toContain("below the profile minimum");
  });

  it("blocks the recovered artifact when a critical finding exists", () => {
    // A missing hard-required field is critical.
    const bundle = buildExportBundle(inputs([], [{ Other: "x" }]));

    expect(bundle.gate.criticalFindingCount).toBeGreaterThan(0);
    expect(bundle.gate.recoveredExportAllowed).toBe(false);
  });

  it("still emits report, audit, CSV, and ticket when the recovered artifact is blocked", () => {
    const bundle = buildExportBundle(inputs([], [{ Other: "x" }]));
    const kinds = bundle.artifacts.map((artifact) => artifact.kind);

    expect(kinds).not.toContain("recovered");
    expect(kinds).toEqual(
      expect.arrayContaining(["quality-report", "recovery-audit", "findings", "contractor-ticket"])
    );
  });

  it("honours a profile that disables a gate check", () => {
    const permissive: SourceProfile = {
      ...belowMinimum,
      exportGate: { blockOnBelowMinimumMatchRate: false, blockOnCriticalFindings: false }
    };
    const bundle = buildExportBundle(inputs([rec()], [rec(), rec({ Id: "b" })], permissive));

    expect(bundle.gate.matchRateBelowMinimum).toBe(true);
    expect(bundle.gate.recoveredExportAllowed).toBe(true);
  });

  it("defaults both checks to enabled when the profile omits the gate", () => {
    const gate = evaluateExportGate(belowMinimum, inputs([rec()], [rec()]).qa, 0.1);
    expect(gate.recoveredExportAllowed).toBe(false);
  });
});

describe("export: recovered artifact", () => {
  it("emits records under the profile's collection path", () => {
    const artifact = buildRecoveredArtifact(inputs([rec()], [rec()]));
    const parsed = JSON.parse(artifact.content);

    expect(Array.isArray(parsed.Records)).toBe(true);
    expect(parsed.Records).toHaveLength(1);
  });

  it("carries a provenance marker so the file cannot pass as a raw scrape", () => {
    const artifact = buildRecoveredArtifact(inputs([rec()], [rec()]));
    const parsed = JSON.parse(artifact.content);

    expect(parsed._provenance.artifact).toBe("recovered");
    expect(parsed._provenance.profileVersion).toBe(4);
    expect(parsed._provenance.note).toContain("NOT produced by the candidate scrape");
    expect(parsed._provenance.auditArtifact).toContain("recovery-audit");
  });

  it("emits a bare array when the collection path is the root", () => {
    const rootArray: SourceProfile = { ...genericProfile, collectionPath: "$" };
    const parsed = JSON.parse(buildRecoveredArtifact(inputs([rec()], [rec()], rootArray)).content);

    expect(Array.isArray(parsed)).toBe(true);
  });

  it("excludes records that dedupe removed and recovery excluded", () => {
    const profile: SourceProfile = { ...genericProfile, primaryKey: ["Id"], dedupeKey: ["Group"] };
    const candidate = [
      { Id: "a", Group: "g" },
      { Id: "b", Group: "g" }
    ];
    const parsed = JSON.parse(buildRecoveredArtifact(inputs([], candidate, profile)).content);

    expect(parsed.Records).toHaveLength(1);
  });
});

describe("export: quality report", () => {
  it("carries run metadata, profile version, and every summary", () => {
    const parsed = JSON.parse(buildQualityReportArtifact(bellinghamInputs()).content);

    expect(parsed.run.profileId).toBe("bellingham-procureware");
    expect(parsed.run.profileVersion).toBe(2);
    expect(parsed.run.generatedAt).toBe(FIXED_NOW);
    expect(parsed.run.hashAlgorithm).toBe("SHA-256");
    expect(parsed.match.candidateCount).toBe(500);
    expect(parsed.qa.counts.total).toBeGreaterThan(0);
    expect(parsed.recovery.summary).toBeDefined();
    expect(parsed.duplicates.summary).toBeDefined();
  });

  it("warns when the match rate is below the minimum", () => {
    const profile: SourceProfile = { ...genericProfile, minimumMatchRate: 0.95 };
    const parsed = JSON.parse(
      buildQualityReportArtifact(inputs([rec()], [rec(), rec({ Id: "b" })], profile)).content
    );

    expect(parsed.warnings.join(" ")).toContain("MATCH RATE BELOW MINIMUM");
  });

  it("warns when critical findings exist", () => {
    const parsed = JSON.parse(buildQualityReportArtifact(inputs([], [{ Other: "x" }])).content);
    expect(parsed.warnings.join(" ")).toContain("CRITICAL FINDINGS");
  });

  it("warns that the recovered export was blocked", () => {
    const parsed = JSON.parse(buildQualityReportArtifact(inputs([], [{ Other: "x" }])).content);
    expect(parsed.warnings.join(" ")).toContain("RECOVERED DATA EXPORT BLOCKED");
  });

  it("emits no warnings on a clean run", () => {
    const parsed = JSON.parse(buildQualityReportArtifact(inputs([rec()], [rec()])).content);
    expect(parsed.warnings).toEqual([]);
  });
});

describe("export: recovery audit", () => {
  it("carries provenance, exclusions, and duplicate removals", () => {
    const parsed = JSON.parse(buildRecoveryAuditArtifact(bellinghamInputs()).content);

    expect(parsed.artifact).toBe("recovery-audit");
    expect(Array.isArray(parsed.provenance)).toBe(true);
    expect(Array.isArray(parsed.excluded)).toBe(true);
    expect(Array.isArray(parsed.duplicatesRemoved)).toBe(true);
    expect(parsed.run.profileVersion).toBe(2);
  });

  it("declares JSON as its content type", () => {
    expect(buildRecoveryAuditArtifact(bellinghamInputs()).contentType).toBe("application/json");
  });

  it("records the reason for every excluded record", () => {
    const parsed = JSON.parse(buildRecoveryAuditArtifact(inputs([], [{ Other: "x" }])).content);

    expect(parsed.excluded.length).toBeGreaterThan(0);
    for (const entry of parsed.excluded) {
      expect(entry.reason).toBeTruthy();
      expect(entry.detail).toBeTruthy();
    }
  });
});

describe("export: CSV escaping", () => {
  it("passes plain values through unquoted", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes values containing commas or newlines", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("neutralizes spreadsheet formula injection", () => {
    expect(escapeCsvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(escapeCsvCell("+1")).toBe("'+1");
    expect(escapeCsvCell("-1")).toBe("'-1");
    expect(escapeCsvCell("@cmd")).toBe("'@cmd");
  });

  it("still quotes a neutralized value that also contains a comma", () => {
    expect(escapeCsvCell("=A,B")).toBe("\"'=A,B\"");
  });

  it("truncates very long cells and says so", () => {
    const cell = escapeCsvCell("x".repeat(600));
    expect(cell).toContain("truncated 100 chars");
  });

  it("serializes non-string values", () => {
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(["a"])).toBe('"[""a""]"');
  });
});

describe("export: findings CSV", () => {
  it("writes a header plus one row per finding", () => {
    const artifact = buildFindingsCsvArtifact(bellinghamInputs());
    const rows = artifact.content.trimEnd().split("\r\n");

    expect(rows[0]).toBe(
      "id,severity,category,fieldPath,recordKey,candidateValue,referenceValue,recommendedAction,message"
    );
    expect(rows).toHaveLength(bellinghamInputs().qa.findings.length + 1);
  });

  it("uses CRLF line endings per RFC 4180", () => {
    expect(buildFindingsCsvArtifact(bellinghamInputs()).content).toContain("\r\n");
  });

  it("declares CSV as its content type", () => {
    expect(buildFindingsCsvArtifact(bellinghamInputs()).contentType).toBe("text/csv");
  });

  it("keeps each record on exactly one row despite embedded newlines", () => {
    const withNewline = [rec({ Note: "line1\nline2" })];
    const artifact = buildFindingsCsvArtifact(inputs(withNewline, [rec({ Note: "" })]));
    // Quoted newlines stay inside their cell, so the raw split exceeds the row count.
    expect(artifact.content).toContain('"line1\nline2"');
  });
});

describe("export: contractor ticket", () => {
  it("is deterministic for identical inputs", () => {
    const a = buildContractorTicketArtifact(bellinghamInputs()).content;
    const b = buildContractorTicketArtifact(bellinghamInputs()).content;
    expect(a).toBe(b);
  });

  it("states that nothing has been sent anywhere", () => {
    const content = buildContractorTicketArtifact(bellinghamInputs()).content;
    expect(content).toContain("No card has been created and no external system has been contacted");
  });

  it("carries run metadata and hashes", () => {
    const content = buildContractorTicketArtifact(bellinghamInputs()).content;

    expect(content).toContain("bellingham-procureware` v2");
    expect(content).toContain(FIXED_NOW);
    expect(content).toContain("candidate SHA-256");
  });

  it("reports an unavailable hash instead of omitting the row", () => {
    const content = buildContractorTicketArtifact(
      inputs([rec()], [rec()], genericProfile, {
        inputHashes: [
          { fileName: "candidate.json", role: "candidate", sha256: null, unavailableReason: "insecure context" }
        ]
      })
    ).content;

    expect(content).toContain("unavailable (insecure context)");
  });

  it("counts every finding in a group even when it shows only examples", () => {
    const content = buildContractorTicketArtifact(bellinghamInputs()).content;
    expect(content).toMatch(/…and \d+ more of this kind/);
  });

  it("lists blocking issues when the gate withholds the data export", () => {
    const content = buildContractorTicketArtifact(inputs([], [{ Other: "x" }])).content;

    expect(content).toContain("Blocking issues");
    expect(content).toContain("recovered data export is withheld");
  });

  it("names the attachments it expects to travel with", () => {
    const content = buildContractorTicketArtifact(bellinghamInputs()).content;
    expect(content).toContain("bellingham-procureware-findings-2026-08-10T00-00-00-000Z.csv");
  });
});

describe("export: secret guard", () => {
  it("rejects content carrying a secret-like key", () => {
    expect(() => assertNoSecrets('{"trelloToken": "abc"}', "x.json")).toThrow(/secret-like key/);
    expect(() => assertNoSecrets('{"api_key": "abc"}', "x.json")).toThrow();
    expect(() => assertNoSecrets('{"Authorization": "Bearer x"}', "x.json")).toThrow();
  });

  it("permits ordinary content", () => {
    expect(() => assertNoSecrets('{"Title": "Water Main Upgrades"}', "x.json")).not.toThrow();
  });

  it("does not fire on a value that merely mentions a token", () => {
    expect(() => assertNoSecrets('{"Description": "token ring network"}', "x.json")).not.toThrow();
  });

  it("passes every real artifact", () => {
    expect(() => buildExportBundle(bellinghamInputs())).not.toThrow();
  });
});

describe("export: bundle and download", () => {
  it("produces all five artifacts on a clean run", () => {
    const bundle = buildExportBundle(inputs([rec()], [rec()]));
    expect(bundle.artifacts.map((artifact) => artifact.kind)).toEqual([
      "recovered",
      "quality-report",
      "recovery-audit",
      "findings",
      "contractor-ticket"
    ]);
  });

  it("gives every artifact a distinct filename", () => {
    const names = buildExportBundle(bellinghamInputs()).artifacts.map((artifact) => artifact.fileName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is deterministic across runs", () => {
    const a = buildExportBundle(bellinghamInputs());
    const b = buildExportBundle(bellinghamInputs());
    expect(a.artifacts.map((x) => x.content)).toEqual(b.artifacts.map((x) => x.content));
  });

  it("returns false from downloadArtifact outside a browser rather than throwing", () => {
    const artifact = buildFindingsCsvArtifact(inputs([rec()], [rec()]));
    expect(downloadArtifact(artifact)).toBe(false);
  });
});

describe("export: real Bellingham fixtures", () => {
  const bundle = buildExportBundle(bellinghamInputs());

  it("blocks nothing — the run is clean under the approved profile", () => {
    expect(bundle.gate.recoveredExportAllowed).toBe(true);
    expect(bundle.gate.criticalFindingCount).toBe(0);
    expect(bundle.blocked).toHaveLength(0);
  });

  it("exports all 500 deduplicated records", () => {
    const recovered = bundle.artifacts.find((artifact) => artifact.kind === "recovered");
    const parsed = JSON.parse(recovered!.content);
    expect(parsed.Export).toHaveLength(500);
  });

  it("declares the reference-derived values the v2 approval produced", () => {
    // Rule 9: the artifact must not pass as an unmodified candidate scrape.
    const recovered = bundle.artifacts.find((artifact) => artifact.kind === "recovered");
    const parsed = JSON.parse(recovered!.content);

    expect(parsed._provenance.containsReferenceDerivedValues).toBe(true);
    expect(parsed._provenance.referenceDerivedValueCount).toBe(413);
    expect(parsed._provenance.profileVersion).toBe(2);
  });

  it("writes one CSV row per finding for the whole regression", () => {
    const csv = bundle.artifacts.find((artifact) => artifact.kind === "findings");
    const rows = csv!.content.trimEnd().split("\r\n");
    expect(rows).toHaveLength(3400); // 3,399 findings plus the header
  });
});
