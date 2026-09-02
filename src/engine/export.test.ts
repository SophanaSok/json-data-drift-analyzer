import { describe, expect, it } from "vitest";
import {
  assertNoSecrets,
  buildContractorTicketArtifact,
  buildDeliveryManifest,
  withDeliveryManifest,
  buildExportBundle,
  buildFileName,
  buildFindingsCsvArtifact,
  buildQualityReportArtifact,
  buildRecoveredArtifact,
  buildRecoveryAuditArtifact,
  buildTicketInputFromExport,
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
import { BELLINGHAM_PROCUREWARE } from "../profiles";
import referenceData from "../test/fixtures/bellingham-reference.json";
import candidateData from "../test/fixtures/bellingham-candidate.json";

const referenceRecords = (referenceData as unknown as { Export: Array<Record<string, unknown>> }).Export;
const candidateRecords = (candidateData as unknown as { Export: Array<Record<string, unknown>> }).Export;

const FIXED_NOW = "2026-08-10T00:00:00.000Z";

/** The approved Bellingham policy, loaded from the single source of truth. */
const bellinghamProfile: SourceProfile = BELLINGHAM_PROCUREWARE;

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
    expect(bundle.blocked[0]!.kind).toBe("recovered");
    expect(bundle.blocked[0]!.reason).toContain("below the profile minimum");
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
    expect(parsed.run.profileVersion).toBe(bellinghamProfile.version);
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
    expect(parsed.run.profileVersion).toBe(bellinghamProfile.version);
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

    expect(content).toContain(`bellingham-procureware\` v${bellinghamProfile.version}`);
    expect(content).toContain(FIXED_NOW);
    // Both runs appear in the compared-runs table with their hashes.
    expect(content).toContain("| Role | File | Export timestamp | SHA-256 |");
    expect(content).toContain("a".repeat(64));
    expect(content).toContain("b".repeat(64));
  });

  it("leads with the ticket title, severity, and labels", () => {
    const content = buildContractorTicketArtifact(bellinghamInputs()).content;

    expect(content.startsWith("# [bellingham-procureware]")).toBe(true);
    expect(content).toContain("**Severity:**");
    expect(content).toContain("source:bellingham-procureware");
  });

  it("reports an unavailable hash instead of omitting the row", () => {
    const content = buildContractorTicketArtifact(
      inputs([rec()], [rec()], genericProfile, {
        inputHashes: [
          { fileName: "candidate.json", role: "candidate", sha256: null, unavailableReason: "insecure context" }
        ]
      })
    ).content;

    expect(content).toContain("unavailable — insecure context");
  });

  it("reports every finding group with counts and percentages", () => {
    const content = buildContractorTicketArtifact(bellinghamInputs()).content;

    expect(content).toContain("| Field | Records affected | Share of matched records | Issue |");
    expect(content).toContain("| `Title` | 499 | 100.0% |");
  });

  it("caps evidence at three examples and says what it omitted", () => {
    const content = buildContractorTicketArtifact(bellinghamInputs()).content;
    expect(content).toMatch(/further example\(s\) omitted/);
  });

  it("hedges on root cause rather than naming a selector", () => {
    const content = buildContractorTicketArtifact(bellinghamInputs()).content;

    expect(content).toContain("Observed behaviour suggests");
    expect(content).toContain("The cause is not established from this data.");
    expect(content).not.toMatch(/querySelector|getElementsBy/);
  });

  it("lists blocking issues when the gate withholds the data export", () => {
    const content = buildContractorTicketArtifact(inputs([], [{ Other: "x" }])).content;

    expect(content).toContain("## Export gate");
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
  const inputsForGate = bellinghamInputs();
  const bundle = buildExportBundle(inputsForGate);

  it("permits the export while naming the systemic loss — deliberate, not an oversight", () => {
    // The gate stays open by design: the recovered artifact is the stopgap this
    // profile explicitly authorizes, and blocking it for the very regression it
    // exists to mitigate would defeat the tool. The catastrophe is NOT silent —
    // the same QA report carries one systemic_field_regression finding per wiped
    // field, and the UI banner states what the gate did and did not check.
    expect(bundle.gate.recoveredExportAllowed).toBe(true);
    expect(bundle.gate.criticalFindingCount).toBe(0);
    expect(bundle.blocked).toHaveLength(0);

    const systemic = inputsForGate.qa.findings.filter(
      (finding) => finding.category === "systemic_field_regression"
    );
    expect(systemic.map((finding) => finding.fieldPath).sort()).toEqual([
      "AwardDate",
      "BidStatus",
      "BidType",
      "ContactEmail",
      "ContactPhone",
      "DueDate",
      "PublishedDate",
      "Title"
    ]);
  });

  it("exports all 500 deduplicated records", () => {
    const recovered = bundle.artifacts.find((artifact) => artifact.kind === "recovered");
    const parsed = JSON.parse(recovered!.content);
    expect(parsed.Export).toHaveLength(500);
  });

  it("declares the reference-derived values the approvals produced", () => {
    // Rule 9: the artifact must not pass as an unmodified candidate scrape.
    const recovered = bundle.artifacts.find((artifact) => artifact.kind === "recovered");
    const parsed = JSON.parse(recovered!.content);

    expect(parsed._provenance.containsReferenceDerivedValues).toBe(true);
    expect(parsed._provenance.referenceDerivedValueCount).toBe(1407);
    expect(parsed._provenance.profileVersion).toBe(bellinghamProfile.version);
  });

  it("writes one CSV row per finding for the whole regression", () => {
    const csv = bundle.artifacts.find((artifact) => artifact.kind === "findings");
    const rows = csv!.content.trimEnd().split("\r\n");
    expect(rows).toHaveLength(3409); // 3,408 findings (dropped-record row plus 8 systemic-loss rows included) and the header
  });
});

describe("export: a dropped record reaches the contractor ticket", () => {
  it("puts a missing-record group in the ticket even when counts are equal", () => {
    // The regression this covers: a 1:1 drop-and-gain produced an empty finding
    // list, so the deliverable sent to the contractor never mentioned the record
    // that disappeared.
    const exportInputs = inputs(
      [rec({ Id: "a" }), rec({ Id: "dropped" })],
      [rec({ Id: "a" }), rec({ Id: "gained" })]
    );

    const ticket = buildTicketInputFromExport(exportInputs);
    expect(ticket.findingGroups.length).toBeGreaterThan(0);
    expect(ticket.findingGroups.some((group) => group.category === "record_missing_from_candidate")).toBe(true);

    const csv = buildFindingsCsvArtifact(exportInputs);
    expect(csv.content).toContain("record_missing_from_candidate");
    expect(csv.content).toContain("dropped");
  });
});

describe("export: round trip (delivery fidelity)", () => {
  it("reproduces the reference records field-for-field, in key order, when nothing is decided", () => {
    // Reference analysed against itself: no regression, no backfill, no dedupe
    // removal — the recovered file must be the input records, untouched.
    const artifact = buildRecoveredArtifact(inputs(referenceRecords, referenceRecords, bellinghamProfile));
    const parsed = JSON.parse(artifact.content) as { Export: Array<Record<string, unknown>> };
    expect(parsed.Export).toHaveLength(referenceRecords.length);
    parsed.Export.forEach((record, index) => {
      const original = referenceRecords[index]!;
      expect(Object.keys(record)).toEqual(Object.keys(original));
      expect(record).toEqual(original);
    });
  });

  it("differs from the candidate only in the cells the audit names as backfilled", () => {
    const exportInputs = inputs(referenceRecords, candidateRecords, bellinghamProfile);
    const artifact = buildRecoveredArtifact(exportInputs);
    const parsed = JSON.parse(artifact.content) as { Export: Array<Record<string, unknown>> };
    const byIndex = new Map(exportInputs.recovery.recovered.map((record) => [record.candidateIndex, record]));

    let backfilledCells = 0;
    let changedCells = 0;
    parsed.Export.forEach((record, position) => {
      const recovered = exportInputs.recovery.recovered[position]!;
      const original = candidateRecords[recovered.candidateIndex]!;
      expect(byIndex.get(recovered.candidateIndex)?.record).toEqual(record);
      expect(Object.keys(record)).toEqual(Object.keys(original));
      const audited = new Set(recovered.backfilledFields);
      for (const field of Object.keys(original)) {
        if (record[field] !== original[field]) {
          changedCells += 1;
          expect(audited.has(field), `${field} changed without an audit entry`).toBe(true);
        }
      }
      backfilledCells += audited.size;
    });
    expect(changedCells).toBe(backfilledCells);
    expect(changedCells).toBeGreaterThan(0);
  });
});

describe("export: delivery manifest", () => {
  const options = { appliedDecisionCount: 2, recordedDecisionCount: 3 };

  it("lists every artifact with its SHA-256 and byte length, never itself", async () => {
    const exportInputs = bellinghamInputs();
    const bundle = buildExportBundle(exportInputs);
    const manifest = await buildDeliveryManifest(bundle, exportInputs, options);
    expect(manifest.kind).toBe("manifest");
    expect(manifest.fileName).toContain("-manifest-");
    const parsed = JSON.parse(manifest.content);
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.files.map((file: { kind: string }) => file.kind)).toEqual(bundle.artifacts.map((artifact) => artifact.kind));
    expect(parsed.files.some((file: { kind: string }) => file.kind === "manifest")).toBe(false);
    for (const [index, file] of parsed.files.entries()) {
      const artifact = bundle.artifacts[index]!;
      expect(file.fileName).toBe(artifact.fileName);
      expect(file.bytes).toBe(new TextEncoder().encode(artifact.content).length);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.sha256).toBe(await hashInputFile(file.fileName, "candidate", artifact.content).then((h) => h.sha256));
    }
  });

  it("records the build, the policy identity, the input hashes, the gate, and the decision counts", async () => {
    const exportInputs = bellinghamInputs();
    const bundle = buildExportBundle(exportInputs);
    const parsed = JSON.parse((await buildDeliveryManifest(bundle, exportInputs, options)).content);
    expect(parsed.run.profileId).toBe("bellingham-procureware");
    expect(parsed.run.profileVersion).toBe(bellinghamProfile.version);
    expect(parsed.run.hashAlgorithm).toBe("SHA-256");
    expect(parsed.run.inputFiles.map((file: { role: string }) => file.role).sort()).toEqual(["candidate", "reference"]);
    expect(typeof parsed.run.appVersion).toBe("string");
    expect(parsed.decisions).toEqual({ applied: 2, recorded: 3 });
    expect(parsed.gate.recoveredExportAllowed).toBe(true);
    expect(parsed.gate.withheld).toEqual([]);
  });

  it("names a withheld artifact when the gate blocks it", async () => {
    const exportInputs = inputs(referenceRecords, candidateRecords, { ...bellinghamProfile, minimumMatchRate: 1 });
    const bundle = buildExportBundle(exportInputs);
    const parsed = JSON.parse((await buildDeliveryManifest(bundle, exportInputs, options)).content);
    expect(parsed.gate.recoveredExportAllowed).toBe(false);
    expect(parsed.gate.withheld.map((entry: { kind: string }) => entry.kind)).toEqual(["recovered"]);
    expect(parsed.files.some((file: { kind: string }) => file.kind === "recovered")).toBe(false);
  });

  it("is deterministic and appends itself last via withDeliveryManifest", async () => {
    const exportInputs = bellinghamInputs();
    const bundle = buildExportBundle(exportInputs);
    const [first, second] = await Promise.all([
      withDeliveryManifest(bundle, exportInputs, options),
      withDeliveryManifest(bundle, exportInputs, options)
    ]);
    expect(first.artifacts.at(-1)?.kind).toBe("manifest");
    expect(first.artifacts).toEqual(second.artifacts);
    // Applying twice does not stack manifests.
    const again = await withDeliveryManifest(first, exportInputs, options);
    expect(again.artifacts.filter((artifact) => artifact.kind === "manifest")).toHaveLength(1);
  });

  it("states why a hash is missing instead of failing when crypto is absent", async () => {
    const saved = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      const exportInputs = bellinghamInputs();
      const parsed = JSON.parse((await buildDeliveryManifest(buildExportBundle(exportInputs), exportInputs, options)).content);
      expect(parsed.files.every((file: { sha256: unknown }) => file.sha256 === null)).toBe(true);
      expect(parsed.files[0].hashUnavailableReason).toContain("SubtleCrypto");
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: saved, configurable: true });
    }
  });
});
