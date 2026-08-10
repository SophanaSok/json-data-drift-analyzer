/**
 * Pure contractor-ticket template.
 *
 * Takes already-derived inputs and returns a draft. It performs no analysis, reads
 * no files, and contacts nothing — creating a Trello card is a network write that
 * needs its own user-facing confirmation step (AGENTS.md rule 11), and nothing here
 * goes near it.
 *
 * Two safety properties are structural rather than advisory:
 *
 * - **No full payloads.** The template can only emit values the caller supplied as
 *   evidence, and every one is truncated. A whole record can never reach the ticket.
 * - **No invented root cause.** Root-cause wording is fixed, hedged prose. The
 *   template never names a selector, an element, or a source-site change, because it
 *   has no way to know any of those. Where a caller supplies such evidence it is
 *   quoted as supplied and labelled as such.
 *
 * No source-specific field name appears here. What identifies the source, which
 * fields matter, and what was recovered all arrive as inputs.
 */

import type { FindingCategory, FindingSeverity } from "./findings";
import type { SourceProfile } from "./adapter-types";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type TicketRunFile = {
  /** File name or run identifier. */
  name: string | null;
  /** Export timestamp as reported by the file, when it carries one. */
  timestamp: string | null;
  sha256: string | null;
  /** Why the hash is absent. Required when sha256 is null, so gaps are explained. */
  hashUnavailableReason: string | null;
};

export type TicketRunMetadata = {
  generatedAt: string;
  candidate: TicketRunFile;
  reference: TicketRunFile;
  /**
   * Rows identifying the source and the bot that produced the export, supplied by
   * the caller. Generic on purpose: the engine must not know which field names
   * carry an agent id for any given source.
   */
  sourceIdentification: Array<{ label: string; value: string }>;
  candidateRecordCount: number;
  referenceRecordCount: number;
  matchedRecordCount: number;
  matchRate: number;
};

export type TicketFindingGroup = {
  category: FindingCategory;
  severity: FindingSeverity;
  /** Field the group concerns, or null for dataset-level groups. */
  field: string | null;
  count: number;
  /** Denominator for the percentage, normally the matched record count. */
  outOf: number;
};

export type TicketExample = {
  /** Identity key of the record, as produced by the matcher. */
  recordKey: string;
  /** Human-facing identifier, when the caller has one. Never guessed here. */
  identityLabel?: string;
  field: string;
  /** Value in the reference export. */
  expected: unknown;
  /** Value in the candidate export. */
  actual: unknown;
};

export type TicketRecoverySummary = {
  /** True when recovery wrote values; false states plainly that none were written. */
  performed: boolean;
  backfilledFieldCount: number;
  recordsWithBackfill: number;
  backfillableFields: string[];
  /** Fields policy withheld, so the ticket shows what was deliberately not done. */
  withheldFields: string[];
  /** Required when performed is false, so "nothing happened" is never unexplained. */
  notPerformedReason?: string;
};

export type TicketInput = {
  profile: SourceProfile;
  run: TicketRunMetadata;
  findingGroups: TicketFindingGroup[];
  examples: TicketExample[];
  recovery: TicketRecoverySummary;
  /**
   * How many examples exist in total, when the caller passes only a sample. Without
   * it a caller that pre-truncates would make the ticket report "0 omitted" — a
   * silent truncation. Defaults to the number of examples supplied.
   */
  totalExamplesAvailable?: number;
  /**
   * Root-cause evidence the caller actually has — a scraper log line, a diffed
   * response, a support reply. Quoted verbatim and attributed. Absent, the ticket
   * says the cause is not established rather than proposing one.
   */
  suppliedRootCauseEvidence?: string[];
};

export type TicketDraft = {
  title: string;
  markdownDescription: string;
  suggestedLabels: string[];
  severity: FindingSeverity;
};

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

const EVIDENCE_VALUE_LIMIT = 120;
const MAX_EXAMPLES = 3;

const CREDENTIAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "bearer token", pattern: /\bbearer\s+[A-Za-z0-9._-]{8,}/i },
  { name: "inline key or token assignment", pattern: /\b(?:api[_-]?key|access[_-]?token|secret|password|passwd)\s*[=:]\s*\S+/i },
  { name: "authorization header", pattern: /\bauthorization\s*:\s*\S+/i },
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }
];

/**
 * Patterns that would mean the ticket is asserting a DOM cause it cannot know.
 *
 * Deliberately narrow: these are high-signal phrasings a generator would only emit
 * if it were inventing a root cause. Ordinary prose and URLs do not match them.
 */
const INVENTED_SELECTOR_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "DOM query call", pattern: /\b(?:querySelector(?:All)?|getElementsBy[A-Za-z]+)\s*\(/ },
  { name: "XPath expression", pattern: /\/\/(?:div|span|table|tr|td|a|p)\[/i },
  { name: "CSS selector chain", pattern: /(?:^|\s)(?:div|span|table|tbody|tr|td|ul|li|a)[.#][A-Za-z][\w-]*/ },
  { name: "selector directive", pattern: /\bcss\s*(?:selector)?\s*[=:]\s*["'.#]/i }
];

/** Throws if the draft carries anything credential-shaped. */
export function assertNoCredentials(markdown: string): void {
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(markdown)) {
      throw new Error(`Refusing to produce ticket: description contains a ${name}.`);
    }
  }
}

/**
 * Throws if the draft names a DOM selector that no supplied evidence contains.
 *
 * A selector quoted from caller-supplied evidence is legitimate — it is something
 * someone observed. One the template produced on its own is a fabricated cause.
 */
export function assertNoInventedSelectors(markdown: string, suppliedEvidence: string[]): void {
  for (const { name, pattern } of INVENTED_SELECTOR_PATTERNS) {
    const match = pattern.exec(markdown);
    if (!match) continue;
    const quoted = suppliedEvidence.some((evidence) => evidence.includes(match[0].trim()));
    if (!quoted) {
      throw new Error(`Refusing to produce ticket: description contains a ${name} not present in supplied evidence.`);
    }
  }
}

/** Single-line, length-capped, and explicit about what it dropped. */
export function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "_(absent)_";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.trim() === "") return "_(blank)_";

  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened.length > EVIDENCE_VALUE_LIMIT
    ? `${flattened.slice(0, EVIDENCE_VALUE_LIMIT)}… _[+${flattened.length - EVIDENCE_VALUE_LIMIT} chars omitted]_`
    : flattened;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

/** Highest severity present, or "info" when there is nothing to report. */
export function deriveSeverity(groups: TicketFindingGroup[]): FindingSeverity {
  for (const severity of SEVERITY_ORDER) {
    if (groups.some((group) => group.severity === severity)) return severity;
  }
  return "info";
}

const CATEGORY_LABEL: Partial<Record<FindingCategory, string>> = {
  field_regression: "field-regression",
  field_conflict: "field-conflict",
  required_field_missing: "required-field-missing",
  schema_field_missing: "schema-change",
  duplicate_identity_key: "duplicate-records",
  record_count_anomaly: "record-count",
  identity_match_issue: "identity-matching",
  field_validation_failure: "validation"
};

export function deriveLabels(input: TicketInput, severity: FindingSeverity): string[] {
  const labels = new Set<string>(["scraper-data-quality", `source:${input.profile.id}`, `severity:${severity}`]);
  for (const group of input.findingGroups) {
    const label = CATEGORY_LABEL[group.category];
    if (label) labels.add(label);
  }
  if (input.recovery.performed) labels.add("recovery-applied");
  return [...labels].sort();
}

/** Field-level groups, largest first, then by field name so ties are stable. */
function fieldGroups(groups: TicketFindingGroup[]): TicketFindingGroup[] {
  return groups
    .filter((group) => group.field !== null)
    .sort((left, right) =>
      right.count !== left.count ? right.count - left.count : (left.field ?? "").localeCompare(right.field ?? "")
    );
}

export function deriveTitle(input: TicketInput): string {
  const affected = fieldGroups(input.findingGroups);
  if (affected.length === 0) {
    return `[${input.profile.id}] Export quality review — no field-level issues found`;
  }

  const leader = affected[0];
  const others = affected.length - 1;
  const scope = others > 0 ? ` and ${others} other field${others === 1 ? "" : "s"}` : "";
  const percentage = formatPercent(leader.count, leader.outOf);

  return `[${input.profile.id}] ${leader.field}${scope} unpopulated in ${leader.count} of ${leader.outOf} records (${percentage})`;
}

function formatPercent(count: number, outOf: number): string {
  if (outOf === 0) return "n/a";
  return `${((count / outOf) * 100).toFixed(1)}%`;
}

function fileRow(role: string, file: TicketRunFile): string {
  const hash = file.sha256 ?? `unavailable — ${file.hashUnavailableReason ?? "no reason recorded"}`;
  return `| ${role} | ${file.name ?? "_(unnamed)_"} | ${file.timestamp ?? "_(not reported)_"} | \`${hash}\` |`;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/**
 * Build the ticket draft.
 *
 * Deterministic: identical inputs produce an identical draft, with no wall-clock
 * read and no unordered iteration.
 *
 * @throws if the assembled description would carry a credential or a root-cause
 *   selector that no supplied evidence contains
 */
export function buildTicketDraft(input: TicketInput): TicketDraft {
  const severity = deriveSeverity(input.findingGroups);
  const affected = fieldGroups(input.findingGroups);
  const lines: string[] = [];

  lines.push("## Source");
  lines.push("");
  lines.push(`Reported by the JSON Data Drift Analyzer, an automated comparison run. No changes were made to either export.`);
  lines.push("");
  lines.push("| Item | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Source profile | \`${input.profile.id}\` v${input.profile.version} |`);
  for (const row of input.run.sourceIdentification) {
    lines.push(`| ${row.label} | ${row.value} |`);
  }
  lines.push(`| Report generated | ${input.run.generatedAt} |`);
  lines.push("");

  lines.push("## Runs compared");
  lines.push("");
  lines.push("| Role | File | Export timestamp | SHA-256 |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(fileRow("Reference (known good)", input.run.reference));
  lines.push(fileRow("Candidate (under investigation)", input.run.candidate));
  lines.push("");
  lines.push(
    `Records: ${input.run.referenceRecordCount} reference, ${input.run.candidateRecordCount} candidate, ` +
      `${input.run.matchedRecordCount} matched (${(input.run.matchRate * 100).toFixed(2)}% match rate).`
  );
  lines.push("");

  lines.push("## Issue summary");
  lines.push("");
  if (affected.length === 0) {
    lines.push("No field-level issues were found.");
    lines.push("");
  } else {
    lines.push("| Field | Records affected | Share of matched records | Issue |");
    lines.push("| --- | ---: | ---: | --- |");
    for (const group of affected) {
      lines.push(
        `| \`${group.field}\` | ${group.count} | ${formatPercent(group.count, group.outOf)} | ${group.category.replace(/_/g, " ")} |`
      );
    }
    lines.push("");
    lines.push("### Affected JSON fields");
    lines.push("");
    lines.push(affected.map((group) => `\`${group.field}\``).join(", "));
    lines.push("");
  }

  const datasetGroups = input.findingGroups.filter((group) => group.field === null);
  if (datasetGroups.length > 0) {
    lines.push("### Dataset-level issues");
    lines.push("");
    for (const group of datasetGroups) {
      lines.push(`- ${group.category.replace(/_/g, " ")} — ${group.count} occurrence(s)`);
    }
    lines.push("");
  }

  lines.push("## Evidence");
  lines.push("");
  if (input.examples.length === 0) {
    lines.push("No representative examples were supplied.");
  } else {
    lines.push("Values are truncated and no full record is included.");
    lines.push("");
    for (const example of input.examples.slice(0, MAX_EXAMPLES)) {
      const identity = example.identityLabel ? `${example.identityLabel} (\`${example.recordKey}\`)` : `\`${example.recordKey}\``;
      lines.push(`**${identity}** — field \`${example.field}\``);
      lines.push("");
      lines.push(`- Expected (reference): ${formatEvidenceValue(example.expected)}`);
      lines.push(`- Actual (candidate): ${formatEvidenceValue(example.actual)}`);
      lines.push("");
    }
    const totalExamples = Math.max(input.totalExamplesAvailable ?? input.examples.length, input.examples.length);
    if (totalExamples > MAX_EXAMPLES) {
      lines.push(`_${totalExamples - MAX_EXAMPLES} further example(s) omitted; the full set is in the attached findings export._`);
      lines.push("");
    }
  }

  lines.push("## Business impact");
  lines.push("");
  if (affected.length === 0) {
    lines.push("No downstream impact identified from this comparison.");
  } else {
    const worst = affected[0];
    lines.push(
      `Downstream consumers reading ${affected.map((group) => `\`${group.field}\``).join(", ")} will find them ` +
        `unpopulated for affected records — up to ${worst.count} of ${worst.outOf} (${formatPercent(worst.count, worst.outOf)}) ` +
        `for \`${worst.field}\`.`
    );
    lines.push("");
    lines.push(
      "Any process that filters, sorts, or notifies on those fields will behave as though the data does not exist, " +
        "rather than failing visibly."
    );
  }
  lines.push("");

  lines.push("## Observed behaviour and possible cause");
  lines.push("");
  lines.push(
    "Observed behaviour suggests that the affected fields stopped being captured between the two runs, while other " +
      "fields in the same records continued to be captured normally."
  );
  lines.push("");
  lines.push(
    "**The cause is not established from this data.** This comparison sees only the exported JSON, so it cannot " +
      "determine which part of the extraction changed, nor whether anything changed on the source site. No selector, " +
      "element, or page structure is asserted here."
  );
  if (input.suppliedRootCauseEvidence && input.suppliedRootCauseEvidence.length > 0) {
    lines.push("");
    lines.push("Evidence supplied with this report, quoted as received:");
    lines.push("");
    for (const evidence of input.suppliedRootCauseEvidence) {
      lines.push(`> ${evidence}`);
    }
  }
  lines.push("");

  lines.push("## Recommended action");
  lines.push("");
  lines.push("1. Confirm whether the affected fields are still present in the upstream source for a sample of the records listed above.");
  lines.push("2. Compare the extraction step that produces those fields against a run that predates the candidate export.");
  lines.push("3. Report which part of the extraction changed, and whether the change originated upstream or in the scraper.");
  lines.push("4. Re-run the export and confirm the affected fields are populated for the same sample records.");
  lines.push("");

  lines.push("## Recovery status");
  lines.push("");
  if (input.recovery.performed) {
    lines.push(
      `A recovered artifact was produced: ${input.recovery.backfilledFieldCount} value(s) restored across ` +
        `${input.recovery.recordsWithBackfill} record(s), limited to the fields the source profile permits ` +
        `(${input.recovery.backfillableFields.map((field) => `\`${field}\``).join(", ") || "none"}).`
    );
    lines.push("");
    lines.push(
      "Restored values came from the matched reference export and are marked as such in the recovery audit. " +
        "**They were not produced by the candidate run and must not be treated as freshly scraped.**"
    );
  } else {
    lines.push(
      `**No recovery was performed.** ${input.recovery.notPerformedReason ?? "No field is approved for automatic backfill for this source."}`
    );
    lines.push("");
    lines.push("The candidate export is unchanged; the missing values remain missing.");
  }
  if (input.recovery.withheldFields.length > 0) {
    lines.push("");
    lines.push(
      `Deliberately not recovered: ${input.recovery.withheldFields.map((field) => `\`${field}\``).join(", ")}. ` +
        "These are date- or state-sensitive, and restoring a stale value could misstate the current position of a solicitation."
    );
  }
  lines.push("");

  lines.push("## Reproduction");
  lines.push("");
  lines.push("1. Obtain both exports listed under **Runs compared**; verify each SHA-256 where one is recorded.");
  lines.push(`2. Open the JSON Data Drift Analyzer and load the reference export as baseline and the candidate export as latest.`);
  lines.push(`3. Set the collection path to \`${input.profile.collectionPath}\`; records are matched on ${input.profile.primaryKey.map((field) => `\`${field}\``).join(" + ")}.`);
  lines.push("4. Open the Recovery tab to see the affected fields and per-record evidence reproduced from the same inputs.");
  lines.push("");
  lines.push(
    `This comparison is deterministic: the same two files under profile \`${input.profile.id}\` v${input.profile.version} ` +
      "produce the same result."
  );

  const markdownDescription = lines.join("\n");
  assertNoCredentials(markdownDescription);
  assertNoInventedSelectors(markdownDescription, input.suppliedRootCauseEvidence ?? []);

  return {
    title: deriveTitle(input),
    markdownDescription,
    suggestedLabels: deriveLabels(input, severity),
    severity
  };
}
