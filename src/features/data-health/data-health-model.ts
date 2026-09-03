/**
 * The Data Health view's model: one severity-ordered list of what is wrong with a
 * run, drawn from both engines.
 *
 * Two independent analyses produce health signals — the drift engine's
 * `qualityIssues` (fill-rate collapses, document regressions) and the QA engine's
 * `findings` (per-cell and per-record evidence). Presenting them as two disconnected
 * lists makes the reader do the merge; presenting the QA findings one row per
 * finding buries the run under thousands of rows. So findings are rolled up per
 * category, keeping the count exact and the worst severity intact, and each row
 * points at the view that can act on it.
 *
 * Pure: the page holds only the filter selection.
 */

import type { AnalysisResult, QualityIssue, Severity } from "../../engine/types";
import type { Finding, FindingCategory, FindingSeverity } from "../../engine/findings";
import type { RecoveryReview } from "../../engine/review";

/** The QA scale; the drift engine's `Severity` is mapped onto it. */
export type HealthSeverity = FindingSeverity;

export const HEALTH_SEVERITY_ORDER: HealthSeverity[] = ["critical", "high", "medium", "low", "info"];

export type HealthItem = {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  /** Records or findings this row stands for; 1 for a single dataset-level issue. */
  count: number;
  /** Fields the row concerns, for the Explore deep links. */
  fields: string[];
  /** Where to act on it, when somewhere better than this page exists. */
  link: { to: string; label: string } | null;
};

export type HealthSection = {
  severity: HealthSeverity;
  items: HealthItem[];
};

export type HealthFilter = {
  severity: HealthSeverity | "all";
  search: string;
};

export const DEFAULT_HEALTH_FILTER: HealthFilter = { severity: "all", search: "" };

/**
 * The drift engine's five-point scale onto the QA one. "warning" becomes medium
 * and "pass" becomes info; nothing is promoted, so a merged list can never make an
 * issue look worse than the engine that raised it said it was.
 */
const DRIFT_SEVERITY: Record<Severity, HealthSeverity> = {
  critical: "critical",
  high: "high",
  warning: "medium",
  info: "info",
  pass: "info"
};

/**
 * What each finding category means in a sentence, for a reader who has not learned
 * the engine's vocabulary. Keyed exhaustively so a new category cannot ship without
 * a label.
 */
const CATEGORY_LABEL: Record<FindingCategory, string> = {
  required_field_missing: "Required field is missing",
  field_validation_failure: "Value failed its format check",
  field_regression: "Value lost that the reference run had",
  systemic_field_regression: "Field lost in every matched record",
  field_conflict: "The two runs disagree on a value",
  schema_field_missing: "Field absent from the candidate schema",
  schema_field_added: "Field new to the candidate schema",
  field_type_change: "Field changed value type",
  duplicate_identity_key: "Records share an identity key",
  record_count_anomaly: "Record count changed",
  record_missing_from_candidate: "Reference record missing from this run",
  identity_match_issue: "Record could not be matched",
  duplicate_title: "Duplicate titles (pipeline alert)"
};

/** Where a reader goes to act on a category. */
const CATEGORY_LINK: Partial<Record<FindingCategory, { to: string; label: string }>> = {
  field_regression: { to: "/results?tab=recovery", label: "Review in Recovery" },
  field_conflict: { to: "/results?tab=recovery", label: "Review in Recovery" },
  systemic_field_regression: { to: "/results?tab=recovery", label: "Review in Recovery" },
  field_validation_failure: { to: "/results?tab=recovery", label: "Review in Recovery" },
  required_field_missing: { to: "/results?tab=recovery", label: "Review in Recovery" },
  record_missing_from_candidate: { to: "/results?tab=records&status=removed", label: "See dropped records" },
  record_count_anomaly: { to: "/results?tab=records", label: "See records" },
  duplicate_identity_key: { to: "/results?tab=recovery", label: "Review in Recovery" },
  identity_match_issue: { to: "/results?tab=recovery", label: "Review in Recovery" }
};

const FIELD_LINK_LIMIT = 12;

function worstSeverity(findings: Finding[]): HealthSeverity {
  for (const severity of HEALTH_SEVERITY_ORDER) {
    if (findings.some((finding) => finding.severity === severity)) return severity;
  }
  return "info";
}

function distinctFields(findings: Finding[]): string[] {
  const fields = new Set<string>();
  for (const finding of findings) {
    // A composite key path ("AgentID,BidURL") names a key definition, not a field
    // Explore can open, so it is not offered as a link.
    if (finding.fieldPath !== null && !finding.fieldPath.includes(",")) fields.add(finding.fieldPath);
  }
  return [...fields].sort();
}

function categoryDetail(category: FindingCategory, findings: Finding[], fields: string[]): string {
  const count = findings.length;
  if (count === 1 && findings[0]) return findings[0].message;

  const scope = fields.length > 0 ? ` across ${fields.length} field${fields.length === 1 ? "" : "s"}` : "";
  return `${count} findings${scope}. ${CATEGORY_LABEL[category]}.`;
}

function itemsFromQualityIssues(issues: QualityIssue[]): HealthItem[] {
  return issues.map((issue) => ({
    id: `quality:${issue.id}`,
    severity: DRIFT_SEVERITY[issue.severity],
    title: issue.title,
    detail: issue.description,
    count: issue.relatedRecordIds.length > 0 ? issue.relatedRecordIds.length : 1,
    fields: issue.relatedFields.slice(0, FIELD_LINK_LIMIT),
    // Records filters on a field, not on an issue id, so the link is built from
    // the issue's own first field rather than from a parameter that route would
    // ignore. Issues naming no field carry no link; their evidence is the text.
    link:
      issue.relatedFields[0] !== undefined
        ? {
            to: `/results?tab=records&field=${encodeURIComponent(issue.relatedFields[0])}`,
            label: "See affected records"
          }
        : null
  }));
}

function itemsFromFindings(findings: Finding[]): HealthItem[] {
  const byCategory = new Map<FindingCategory, Finding[]>();
  for (const finding of findings) {
    const bucket = byCategory.get(finding.category);
    if (bucket) bucket.push(finding);
    else byCategory.set(finding.category, [finding]);
  }

  return [...byCategory.entries()].map(([category, categoryFindings]) => {
    const fields = distinctFields(categoryFindings);
    return {
      id: `finding:${category}`,
      severity: worstSeverity(categoryFindings),
      title: CATEGORY_LABEL[category],
      detail: categoryDetail(category, categoryFindings, fields),
      count: categoryFindings.length,
      fields: fields.slice(0, FIELD_LINK_LIMIT),
      link: CATEGORY_LINK[category] ?? null
    };
  });
}

/**
 * Every health signal for the run, grouped by severity, worst first.
 *
 * A run with no review (no source profile) still gets its drift issues rather than
 * an empty page.
 */
export function buildHealthSections(analysis: AnalysisResult, review: RecoveryReview | null): HealthSection[] {
  const items = [...itemsFromQualityIssues(analysis.qualityIssues), ...itemsFromFindings(review?.qa.findings ?? [])];

  return HEALTH_SEVERITY_ORDER.map((severity) => ({
    severity,
    items: items
      .filter((item) => item.severity === severity)
      .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title))
  })).filter((section) => section.items.length > 0);
}

export function filterHealthSections(sections: HealthSection[], filter: HealthFilter): HealthSection[] {
  const needle = filter.search.trim().toLowerCase();

  return sections
    .filter((section) => filter.severity === "all" || section.severity === filter.severity)
    .map((section) => ({
      severity: section.severity,
      items:
        needle.length === 0
          ? section.items
          : // The id carries the engine's own vocabulary — the category name a
            // reader has seen in the findings CSV, the ticket, and the Recovery
            // filters — so searching "systemic" finds the row its human title
            // calls "Field lost in every matched record".
            section.items.filter((item) =>
              `${item.id} ${item.title} ${item.detail} ${item.fields.join(" ")}`.toLowerCase().includes(needle)
            )
    }))
    .filter((section) => section.items.length > 0);
}

export function countHealthItems(sections: HealthSection[]): number {
  return sections.reduce((total, section) => total + section.items.length, 0);
}

export function isHealthFilterActive(filter: HealthFilter): boolean {
  return filter.severity !== "all" || filter.search.trim().length > 0;
}
