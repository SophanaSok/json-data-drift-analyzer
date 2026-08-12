/**
 * Local export artifacts.
 *
 * Everything here is built in memory and handed to the browser as a download. There
 * is no upload, no network call, and no Trello integration (AGENTS.md rules 8, 11) —
 * `buildContractorTicket` produces Markdown for a person to paste, nothing more.
 *
 * Artifact construction is pure and synchronous so it is fully testable. Hashing is
 * async and lives in `hashInputFile`; the one impure function is `downloadArtifact`,
 * which touches the DOM and no-ops outside a browser.
 *
 * Rule 9 holds through the export layer: the recovered artifact carries a provenance
 * marker rather than presenting reference-derived values as candidate-scraped.
 */

import { APP_VERSION, BUILD_COMMIT } from "../lib/build-info";
import { hashText } from "../lib/hash";
import type { FindingSeverity } from "./findings";
import type { QaReport } from "./qa";
import type { RecoveryResult } from "./recovery";
import type { DedupeResult } from "./dedupe";
import type { SourceProfile } from "./adapter-types";
import { buildTicketDraft, type TicketFindingGroup, type TicketInput } from "./ticketTemplate";

export type ExportArtifactKind =
  | "recovered"
  | "quality-report"
  | "recovery-audit"
  | "findings"
  | "contractor-ticket";

export type ExportArtifact = {
  kind: ExportArtifactKind;
  fileName: string;
  contentType: string;
  content: string;
};

export type InputFileHash = {
  fileName: string;
  role: "candidate" | "reference";
  sha256: string | null;
  /** Populated when hashing could not run; sha256 is null in that case. */
  unavailableReason: string | null;
};

export type ExportGateResult = {
  /** False when the profile's gate blocks the recovered data artifact. */
  recoveredExportAllowed: boolean;
  /** Human-readable reasons the artifact is blocked. Empty when allowed. */
  blockingReasons: string[];
  matchRateBelowMinimum: boolean;
  criticalFindingCount: number;
};

export type ExportInputs = {
  profile: SourceProfile;
  qa: QaReport;
  recovery: RecoveryResult;
  dedupe: DedupeResult;
  /** ISO-8601. Injectable so identical inputs produce identical artifacts. */
  generatedAt: string;
  inputHashes: InputFileHash[];
  sourceRun?: string | null;
  referenceRun?: string | null;
  /** Rows identifying the source and bot, passed through to the ticket. */
  sourceIdentification?: Array<{ label: string; value: string }>;
  /** Root-cause evidence someone actually has; quoted verbatim, never invented. */
  suppliedRootCauseEvidence?: string[];
};

export type ExportBundle = {
  gate: ExportGateResult;
  /** Artifacts the gate permits, in a stable order. */
  artifacts: ExportArtifact[];
  /** Artifacts withheld by the gate, each with the reason. */
  blocked: Array<{ kind: ExportArtifactKind; reason: string }>;
};

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

function subtleCryptoAvailable(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === "function";
}

/**
 * SHA-256 an input file's text.
 *
 * SubtleCrypto is unavailable in insecure (non-HTTPS, non-localhost) contexts, so a
 * missing hash is a normal outcome rather than an error. It is reported explicitly:
 * a null hash always carries a reason, never a silent absence.
 */
export async function hashInputFile(
  fileName: string,
  role: InputFileHash["role"],
  text: string
): Promise<InputFileHash> {
  if (!subtleCryptoAvailable()) {
    return {
      fileName,
      role,
      sha256: null,
      unavailableReason: "SubtleCrypto unavailable in this context (requires a secure context)"
    };
  }

  try {
    return { fileName, role, sha256: await hashText(text), unavailableReason: null };
  } catch (error) {
    return {
      fileName,
      role,
      sha256: null,
      unavailableReason: error instanceof Error ? error.message : "hashing failed"
    };
  }
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

/** Filesystem-safe slug: keeps the value recognisable without inventing characters. */
function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
}

/** `2026-08-10T00:00:00.000Z` -> `2026-08-10T00-00-00-000Z`. */
export function timestampSlug(isoTimestamp: string): string {
  return slugify(isoTimestamp.replace(/[:.]/g, "-"));
}

const EXTENSIONS: Record<ExportArtifactKind, string> = {
  recovered: "json",
  "quality-report": "json",
  "recovery-audit": "json",
  findings: "csv",
  "contractor-ticket": "md"
};

/** Filenames carry the profile id and run timestamp so downloads never collide. */
export function buildFileName(kind: ExportArtifactKind, profileId: string, generatedAt: string): string {
  return `${slugify(profileId)}-${kind}-${timestampSlug(generatedAt)}.${EXTENSIONS[kind]}`;
}

// ---------------------------------------------------------------------------
// Safety gate
// ---------------------------------------------------------------------------

/**
 * Decide whether the recovered DATA artifact may be exported.
 *
 * Reports and audits are never gated. Blocking them would hide the very evidence a
 * reviewer needs, and they contain no data anyone could mistake for a clean export.
 */
export function evaluateExportGate(
  profile: SourceProfile,
  qa: QaReport,
  matchRate: number
): ExportGateResult {
  const blockOnMatchRate = profile.exportGate?.blockOnBelowMinimumMatchRate ?? true;
  const blockOnCritical = profile.exportGate?.blockOnCriticalFindings ?? true;

  const matchRateBelowMinimum = matchRate < profile.minimumMatchRate;
  const criticalFindingCount = qa.findings.filter((finding) => finding.severity === "critical").length;

  const blockingReasons: string[] = [];
  if (blockOnMatchRate && matchRateBelowMinimum) {
    blockingReasons.push(
      `Match rate ${matchRate.toFixed(4)} is below the profile minimum ${profile.minimumMatchRate}.`
    );
  }
  if (blockOnCritical && criticalFindingCount > 0) {
    blockingReasons.push(`${criticalFindingCount} critical finding(s) are unresolved.`);
  }

  return {
    recoveredExportAllowed: blockingReasons.length === 0,
    blockingReasons,
    matchRateBelowMinimum,
    criticalFindingCount
  };
}

// ---------------------------------------------------------------------------
// Secret guard
// ---------------------------------------------------------------------------

const SECRET_KEY_PATTERN = /"(?:[^"]*(?:token|secret|password|passwd|api[-_]?key|authorization|credential)[^"]*)"\s*:/i;

/**
 * Reject an artifact that looks like it carries a credential.
 *
 * None of the engine types hold secrets today, so this is a tripwire against a future
 * change quietly widening what gets serialized — Trello tokens in particular must
 * never reach a file (AGENTS.md rule 9 on secrets).
 */
export function assertNoSecrets(content: string, fileName: string): void {
  const match = SECRET_KEY_PATTERN.exec(content);
  if (match) {
    throw new Error(`Refusing to export ${fileName}: content contains a secret-like key (${match[0].trim()})`);
  }
}

// ---------------------------------------------------------------------------
// Shared metadata
// ---------------------------------------------------------------------------

type RunMetadata = ReturnType<typeof buildRunMetadata>;

function buildRunMetadata(inputs: ExportInputs) {
  return {
    generatedAt: inputs.generatedAt,
    // The build that produced these numbers — "dev" outside a CI build.
    buildCommit: BUILD_COMMIT,
    appVersion: APP_VERSION,
    profileId: inputs.profile.id,
    profileVersion: inputs.profile.version,
    matchingKey: inputs.profile.primaryKey,
    dedupeKey: inputs.profile.dedupeKey,
    sourceRun: inputs.sourceRun ?? inputs.recovery.sourceRun,
    referenceRun: inputs.referenceRun ?? inputs.recovery.referenceRun,
    inputFiles: inputs.inputHashes.map((hash) => ({
      fileName: hash.fileName,
      role: hash.role,
      sha256: hash.sha256,
      hashUnavailableReason: hash.unavailableReason
    })),
    hashAlgorithm: "SHA-256",
    hashesAvailable: inputs.inputHashes.every((hash) => hash.sha256 !== null)
  };
}

/** Retained, valid records in stable order, resolved back to their record objects. */
function retainedRecords(inputs: ExportInputs): Array<Record<string, unknown>> {
  const byCandidateIndex = new Map(
    inputs.recovery.recovered.map((record) => [record.candidateIndex, record])
  );

  return inputs.dedupe.retained
    .filter((participant) => participant.validity === "valid" && participant.candidateIndex !== null)
    .map((participant) => byCandidateIndex.get(participant.candidateIndex as number))
    .filter((record): record is NonNullable<typeof record> => record !== undefined)
    .map((record) => record.record);
}

// ---------------------------------------------------------------------------
// Artifact builders
// ---------------------------------------------------------------------------

/**
 * The usable, deduplicated data.
 *
 * Records are emitted under the profile's collectionPath so the file is shaped like
 * the source and can be consumed in its place. A `_provenance` sibling records that
 * the file may contain reference-derived values, which is what keeps rule 9 true of
 * the artifact itself rather than only of the audit log.
 *
 * When collectionPath is "$" the root IS the records array, so there is nowhere to
 * put that marker; the quality report notes it instead.
 */
export function buildRecoveredArtifact(inputs: ExportInputs): ExportArtifact {
  const records = retainedRecords(inputs);
  const rootIsArray = inputs.profile.collectionPath === "$";

  const payload = rootIsArray
    ? records
    : {
        [inputs.profile.collectionPath]: records,
        _provenance: {
          artifact: "recovered",
          generatedAt: inputs.generatedAt,
          profileId: inputs.profile.id,
          profileVersion: inputs.profile.version,
          containsReferenceDerivedValues: inputs.recovery.containsReferenceDerivedValues,
          referenceDerivedValueCount: inputs.recovery.summary.backfilledFieldCount,
          manualOverrideCount: inputs.recovery.summary.overriddenFieldCount,
          note: "Derived artifact. Values marked reference_backfill in the recovery audit were NOT produced by the candidate scrape.",
          auditArtifact: buildFileName("recovery-audit", inputs.profile.id, inputs.generatedAt)
        }
      };

  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const fileName = buildFileName("recovered", inputs.profile.id, inputs.generatedAt);
  assertNoSecrets(content, fileName);

  return { kind: "recovered", fileName, contentType: "application/json", content };
}

export function buildQualityReportArtifact(inputs: ExportInputs): ExportArtifact {
  const metadata: RunMetadata = buildRunMetadata(inputs);
  const gate = evaluateExportGate(inputs.profile, inputs.qa, inputs.qa.matchReport.matchRate);

  const warnings: string[] = [];
  if (gate.matchRateBelowMinimum) {
    warnings.push(
      `MATCH RATE BELOW MINIMUM: ${inputs.qa.matchReport.matchRate.toFixed(4)} against a required ${inputs.profile.minimumMatchRate}. Record pairing is not trustworthy.`
    );
  }
  if (gate.criticalFindingCount > 0) {
    warnings.push(`CRITICAL FINDINGS: ${gate.criticalFindingCount} unresolved. Review before using this data.`);
  }
  if (!metadata.hashesAvailable) {
    warnings.push("INPUT HASHES UNAVAILABLE: this run cannot prove which files it read.");
  }
  if (!gate.recoveredExportAllowed) {
    warnings.push("RECOVERED DATA EXPORT BLOCKED by the profile safety gate. Report and audit remain available.");
  }
  if (inputs.profile.collectionPath === "$" && inputs.recovery.containsReferenceDerivedValues) {
    warnings.push(
      "RECOVERED ARTIFACT HAS A ROOT ARRAY, so it carries no inline provenance marker. Reference-derived values are listed in the recovery audit."
    );
  }
  if (!inputs.dedupe.summary.accountedFor) {
    warnings.push("DEDUPE ACCOUNTING MISMATCH: retained + removed + carried does not equal the participant count.");
  }

  const payload = {
    artifact: "quality-report",
    run: metadata,
    warnings,
    gate,
    match: {
      candidateCount: inputs.qa.matchReport.candidateCount,
      referenceCount: inputs.qa.matchReport.referenceCount,
      matchRate: inputs.qa.matchReport.matchRate,
      minimumMatchRate: inputs.profile.minimumMatchRate,
      meetsMinimumMatchRate: inputs.qa.matchReport.meetsMinimumMatchRate,
      counts: inputs.qa.matchReport.counts
    },
    qa: { counts: inputs.qa.counts, findings: inputs.qa.findings },
    recovery: {
      summary: inputs.recovery.summary,
      containsReferenceDerivedValues: inputs.recovery.containsReferenceDerivedValues
    },
    duplicates: {
      summary: inputs.dedupe.summary,
      groups: inputs.dedupe.groups.map((group) => ({
        dedupeKey: group.dedupeKey,
        memberCount: group.memberCount,
        winnerCandidateIndex: group.winner.candidateIndex,
        removedCandidateIndexes: group.removed.map((entry) => entry.removed.candidateIndex)
      }))
    }
  };

  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const fileName = buildFileName("quality-report", inputs.profile.id, inputs.generatedAt);
  assertNoSecrets(content, fileName);

  return { kind: "quality-report", fileName, contentType: "application/json", content };
}

export function buildRecoveryAuditArtifact(inputs: ExportInputs): ExportArtifact {
  const payload = {
    artifact: "recovery-audit",
    run: buildRunMetadata(inputs),
    provenance: inputs.recovery.provenance,
    excluded: inputs.recovery.excluded,
    candidateOnly: inputs.recovery.candidateOnly,
    duplicatesRemoved: inputs.dedupe.removed.map((entry) => ({
      dedupeKey: entry.dedupeKey,
      reason: entry.reason,
      detail: entry.detail,
      removedCandidateIndex: entry.removed.candidateIndex,
      removedRecordKey: entry.removed.recordKey,
      winnerCandidateIndex: entry.winner.candidateIndex,
      winnerRecordKey: entry.winner.recordKey
    }))
  };

  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const fileName = buildFileName("recovery-audit", inputs.profile.id, inputs.generatedAt);
  assertNoSecrets(content, fileName);

  return { kind: "recovery-audit", fileName, contentType: "application/json", content };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CSV_MAX_CELL = 500;

/**
 * RFC 4180 escaping, plus neutralization of spreadsheet formula injection.
 *
 * A cell beginning with `=`, `+`, `-`, `@`, tab, or CR is prefixed with a single
 * quote so a spreadsheet renders it as text. Scraped values are untrusted input and
 * this file is meant to be opened in Excel or Sheets.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (text.length > CSV_MAX_CELL) {
    // Explicit, never silent.
    text = `${text.slice(0, CSV_MAX_CELL)}…[truncated ${text.length - CSV_MAX_CELL} chars]`;
  }
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_COLUMNS = [
  "id",
  "severity",
  "category",
  "fieldPath",
  "recordKey",
  "candidateValue",
  "referenceValue",
  "recommendedAction",
  "message"
] as const;

export function buildFindingsCsvArtifact(inputs: ExportInputs): ExportArtifact {
  const rows = inputs.qa.findings.map((finding) =>
    [
      finding.id,
      finding.severity,
      finding.category,
      finding.fieldPath,
      finding.recordKey,
      finding.candidateValue,
      finding.referenceValue,
      finding.recommendedAction,
      finding.message
    ]
      .map(escapeCsvCell)
      .join(",")
  );

  // CRLF per RFC 4180.
  const content = `${[CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
  const fileName = buildFileName("findings", inputs.profile.id, inputs.generatedAt);
  assertNoSecrets(content, fileName);

  return { kind: "findings", fileName, contentType: "text/csv", content };
}

// ---------------------------------------------------------------------------
// Contractor ticket
// ---------------------------------------------------------------------------

const TICKET_EXAMPLE_LIMIT = 3;

/**
 * Derive the ticket template's inputs from an export run.
 *
 * The ticket's content lives in ./ticketTemplate.ts. This function only translates
 * what an export already knows into that shape — deriving it in two places is how
 * two tickets end up disagreeing about the same run.
 */
export function buildTicketInputFromExport(inputs: ExportInputs): TicketInput {
  const matchedCount = inputs.qa.matchReport.counts.matched_primary + inputs.qa.matchReport.counts.matched_fallback;

  const groups = new Map<string, TicketFindingGroup>();
  for (const finding of inputs.qa.findings) {
    const key = `${finding.category}|${finding.fieldPath ?? ""}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      // A group takes the most severe finding it contains.
      if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) {
        existing.severity = finding.severity;
      }
      continue;
    }
    groups.set(key, {
      category: finding.category,
      severity: finding.severity,
      field: finding.fieldPath,
      count: 1,
      outOf: matchedCount
    });
  }

  // Evidence comes from findings that actually carry both sides of the comparison.
  const evidenceFindings = inputs.qa.findings.filter(
    (finding) => finding.recordKey !== null && finding.fieldPath !== null && finding.referenceValue !== undefined
  );
  const examples = evidenceFindings
    .slice(0, TICKET_EXAMPLE_LIMIT)
    .map((finding) => ({
      recordKey: finding.recordKey as string,
      field: finding.fieldPath as string,
      expected: finding.referenceValue,
      actual: finding.candidateValue
    }));

  const hashFor = (role: "candidate" | "reference") => {
    const hash = inputs.inputHashes.find((entry) => entry.role === role);
    return {
      name: hash?.fileName ?? (role === "candidate" ? inputs.sourceRun ?? null : inputs.referenceRun ?? null),
      // An export run does not carry the exports' own timestamps; the template
      // renders "not reported" rather than inventing one.
      timestamp: null,
      sha256: hash?.sha256 ?? null,
      hashUnavailableReason: hash?.unavailableReason ?? "no hash was computed for this run"
    };
  };

  return {
    profile: inputs.profile,
    run: {
      generatedAt: inputs.generatedAt,
      candidate: hashFor("candidate"),
      reference: hashFor("reference"),
      sourceIdentification: inputs.sourceIdentification ?? [],
      candidateRecordCount: inputs.qa.matchReport.candidateCount,
      referenceRecordCount: inputs.qa.matchReport.referenceCount,
      matchedRecordCount: matchedCount,
      matchRate: inputs.qa.matchReport.matchRate
    },
    findingGroups: [...groups.values()],
    examples,
    // The true total, so the ticket reports what it left out rather than implying
    // these three are all there was.
    totalExamplesAvailable: evidenceFindings.length,
    recovery: {
      performed: inputs.recovery.summary.backfilledFieldCount > 0,
      backfilledFieldCount: inputs.recovery.summary.backfilledFieldCount,
      recordsWithBackfill: inputs.recovery.summary.recordsWithBackfill,
      backfillableFields: inputs.recovery.summary.backfillableFields,
      withheldFields: inputs.recovery.summary.dateSensitiveFieldsWithheld,
      notPerformedReason:
        inputs.recovery.summary.backfillableFields.length === 0
          ? "No field is approved for automatic backfill for this source."
          : "No candidate record met the conditions for backfill."
    },
    suppliedRootCauseEvidence: inputs.suppliedRootCauseEvidence
  };
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4
};

/**
 * A Trello-ready Markdown draft.
 *
 * The ticket body comes from `buildTicketDraft`, which owns the wording and the
 * safety rules. This function adds only what belongs to the export rather than the
 * ticket: the artifact framing, the export gate's verdict, and the attachment list.
 *
 * Produces text. Creating a card is a network write needing a user-facing
 * confirmation step (AGENTS.md rule 11); nothing here talks to Trello.
 */
export function buildContractorTicketArtifact(inputs: ExportInputs): ExportArtifact {
  const draft = buildTicketDraft(buildTicketInputFromExport(inputs));
  const gate = evaluateExportGate(inputs.profile, inputs.qa, inputs.qa.matchReport.matchRate);

  const lines: string[] = [];
  lines.push(`# ${draft.title}`);
  lines.push("");
  lines.push(`**Severity:** ${draft.severity} · **Labels:** ${draft.suggestedLabels.join(", ")}`);
  lines.push("");
  lines.push("**This is a draft for review. No card has been created and no external system has been contacted.**");
  lines.push("");
  lines.push(draft.markdownDescription);
  lines.push("");

  if (gate.blockingReasons.length > 0) {
    lines.push("## Export gate");
    lines.push("");
    for (const reason of gate.blockingReasons) {
      lines.push(`- ${reason}`);
    }
    lines.push("");
    lines.push("The recovered data export is withheld until these are resolved.");
    lines.push("");
  }

  lines.push("## Attachments");
  lines.push("");
  lines.push(`- \`${buildFileName("findings", inputs.profile.id, inputs.generatedAt)}\` — every finding, one row each`);
  lines.push(`- \`${buildFileName("quality-report", inputs.profile.id, inputs.generatedAt)}\` — full run metadata and counts`);
  lines.push(`- \`${buildFileName("recovery-audit", inputs.profile.id, inputs.generatedAt)}\` — field-level provenance and exclusion reasons`);
  lines.push("");

  const content = lines.join("\n");
  const fileName = buildFileName("contractor-ticket", inputs.profile.id, inputs.generatedAt);
  assertNoSecrets(content, fileName);

  return { kind: "contractor-ticket", fileName, contentType: "text/markdown", content };
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

/**
 * Build every artifact the gate permits.
 *
 * The recovered data artifact is the only one that can be withheld; reports and
 * audits always build, so a blocked run still produces the evidence explaining why.
 */
export function buildExportBundle(inputs: ExportInputs): ExportBundle {
  const gate = evaluateExportGate(inputs.profile, inputs.qa, inputs.qa.matchReport.matchRate);
  const artifacts: ExportArtifact[] = [];
  const blocked: ExportBundle["blocked"] = [];

  if (gate.recoveredExportAllowed) {
    artifacts.push(buildRecoveredArtifact(inputs));
  } else {
    blocked.push({ kind: "recovered", reason: gate.blockingReasons.join(" ") });
  }

  artifacts.push(buildQualityReportArtifact(inputs));
  artifacts.push(buildRecoveryAuditArtifact(inputs));
  artifacts.push(buildFindingsCsvArtifact(inputs));
  artifacts.push(buildContractorTicketArtifact(inputs));

  return { gate, artifacts, blocked };
}

// ---------------------------------------------------------------------------
// Browser download
// ---------------------------------------------------------------------------

/**
 * Hand an artifact to the browser as a download.
 *
 * The only impure function here. Returns false outside a browser rather than
 * throwing, so callers can build artifacts in any environment.
 */
export function downloadArtifact(artifact: ExportArtifact): boolean {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") {
    return false;
  }

  const blob = new Blob([artifact.content], { type: `${artifact.contentType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}
