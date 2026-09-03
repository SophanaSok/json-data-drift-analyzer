/**
 * Triage for the pipeline's duplicate-titles alert.
 *
 * The upstream pipeline puts a batch on hold when three or more child runs share
 * a title, and the analyst then has to decide whether that duplication is real or
 * the recurring annual solicitations this source has always had. The QA engine
 * already emits a `duplicate_title` finding per group with the reference-run count
 * (see `alerts.duplicateTitle` in the profile); this module turns that set of
 * findings into the one sentence the analyst needs and the note they paste back
 * into the pipeline when they release the hold.
 *
 * Pure and UI-free so the verdict can be asserted directly. Releasing a hold stays
 * a manual action in the pipeline's own UI (AGENTS.md rule 11) — nothing here
 * contacts it, and the note says what was checked rather than what to do.
 */

import type { Finding } from "../../engine/findings";

export type DuplicateTitleGroup = {
  title: string;
  /** Records sharing this title in the candidate run. */
  candidateCount: number;
  /** Records sharing it in the reference run; 0 when the title is new. */
  referenceCount: number;
  /** True when the reference run already had this group at alert size. */
  preExisting: boolean;
  /** Identity keys of the candidate members, in record order. */
  recordKeys: string[];
};

export type TriageOutcome =
  /** The profile configures no duplicate-title alert, so nothing was checked. */
  | "not-configured"
  /** Configured, and no group reaches the threshold. */
  | "clear"
  /** Every group at or above the threshold was already in the reference run. */
  | "recurring"
  /** At least one group is new to this run. */
  | "new";

export type TriageVerdict = {
  outcome: TriageOutcome;
  /** The record field the alert groups on; null when not configured. */
  field: string | null;
  /** Group size that trips the alert; null when not configured. */
  threshold: number | null;
  /** New groups first, then largest first — the reading order for triage. */
  groups: DuplicateTitleGroup[];
  newGroups: number;
  preExistingGroups: number;
  largestGroupSize: number;
  /** One sentence stating what the run shows. */
  headline: string;
};

export type TriageContext = {
  profileLabel: string;
  profileVersion: number;
  policyHash: string | null;
  sourceRun: string | null;
  referenceRun: string | null;
  appVersion: string;
};

/** The `alerts.duplicateTitle` block from the effective profile, or null. */
export type DuplicateTitleAlert = { field: string; threshold: number } | null;

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readGroup(finding: Finding): DuplicateTitleGroup | null {
  const evidence = finding.evidence;
  const title = typeof evidence.title === "string" ? evidence.title : null;
  const candidateCount = readNumber(evidence.candidateCount);
  if (title === null || candidateCount === null) return null;

  const members = Array.isArray(evidence.members) ? evidence.members : [];
  return {
    title,
    candidateCount,
    referenceCount: readNumber(evidence.referenceCount) ?? 0,
    preExisting: evidence.preExisting === true,
    recordKeys: members
      .map((member) =>
        member !== null && typeof member === "object" && typeof (member as { recordKey?: unknown }).recordKey === "string"
          ? ((member as { recordKey: string }).recordKey)
          : null
      )
      .filter((key): key is string => key !== null)
  };
}

/**
 * Build the verdict from this run's findings and the policy that governed it.
 *
 * `alert` comes from the profile rather than the findings, so a run where nothing
 * tripped still reports the threshold it was checked against — "clear" has to mean
 * "checked and clear", never "no findings, cause unknown".
 */
export function buildDuplicateTitleTriage(findings: Finding[], alert: DuplicateTitleAlert): TriageVerdict {
  if (alert === null) {
    return {
      outcome: "not-configured",
      field: null,
      threshold: null,
      groups: [],
      newGroups: 0,
      preExistingGroups: 0,
      largestGroupSize: 0,
      headline:
        "This source's profile configures no duplicate-title alert, so this run was not checked for duplicate titles."
    };
  }

  const groups = findings
    .filter((finding) => finding.category === "duplicate_title")
    .map(readGroup)
    .filter((group): group is DuplicateTitleGroup => group !== null)
    .sort((left, right) => {
      if (left.preExisting !== right.preExisting) return left.preExisting ? 1 : -1;
      if (left.candidateCount !== right.candidateCount) return right.candidateCount - left.candidateCount;
      return left.title.localeCompare(right.title);
    });

  const newGroups = groups.filter((group) => !group.preExisting).length;
  const preExistingGroups = groups.length - newGroups;
  const largestGroupSize = groups.reduce((largest, group) => Math.max(largest, group.candidateCount), 0);
  const noun = `${alert.field} group${groups.length === 1 ? "" : "s"}`;

  if (groups.length === 0) {
    return {
      outcome: "clear",
      field: alert.field,
      threshold: alert.threshold,
      groups,
      newGroups,
      preExistingGroups,
      largestGroupSize,
      headline: `No ${alert.field} is shared by ${alert.threshold} or more records in this run.`
    };
  }

  const scale = `${groups.length} ${noun} of ${alert.threshold} or more records (largest ${largestGroupSize})`;

  if (newGroups === 0) {
    return {
      outcome: "recurring",
      field: alert.field,
      threshold: alert.threshold,
      groups,
      newGroups,
      preExistingGroups,
      largestGroupSize,
      headline: `${scale} — all ${groups.length} are also in the reference run. Nothing new in this run.`
    };
  }

  return {
    outcome: "new",
    field: alert.field,
    threshold: alert.threshold,
    groups,
    newGroups,
    preExistingGroups,
    largestGroupSize,
    headline:
      `${scale} — ${newGroups} new in this run` +
      (preExistingGroups > 0 ? `, ${preExistingGroups} also in the reference run.` : ".")
  };
}

/**
 * Recover the alert configuration from the findings themselves.
 *
 * A review can outlive the profile that produced it — an analysis restored from
 * cache after the profile was renamed, or a colleague's run under a source this
 * build does not register. The findings still carry the field and threshold that
 * governed them, and using those is more truthful than reporting "not configured"
 * about a run that was demonstrably checked.
 */
export function alertFromFindings(findings: Finding[]): DuplicateTitleAlert {
  for (const finding of findings) {
    if (finding.category !== "duplicate_title") continue;
    const threshold = readNumber(finding.evidence.threshold);
    if (finding.fieldPath !== null && threshold !== null) {
      return { field: finding.fieldPath, threshold };
    }
  }
  return null;
}

/** Titles a reviewer has to look at: the groups this run introduced. */
export function newGroupTitles(verdict: TriageVerdict): string[] {
  return verdict.groups.filter((group) => !group.preExisting).map((group) => group.title);
}

const NOTE_LIMIT = 5;

/**
 * The note the analyst pastes into the pipeline when releasing (or keeping) a hold.
 *
 * It states what was compared and what was found, and stops there: the decision and
 * the release itself belong to the person, and the note has to survive being read
 * weeks later by someone who never opened this app, so it names the runs, the policy
 * version, and the build that produced it.
 */
export function buildTriageNote(verdict: TriageVerdict, context: TriageContext): string {
  const lines = [
    `Duplicate-title check — ${context.profileLabel}`,
    `Candidate run: ${context.sourceRun ?? "(unnamed)"}`,
    `Reference run: ${context.referenceRun ?? "(unnamed)"}`,
    ""
  ];

  if (verdict.outcome === "not-configured") {
    lines.push(verdict.headline);
  } else {
    lines.push(verdict.headline);
    if (verdict.groups.length > 0) {
      lines.push("");
      for (const group of verdict.groups.slice(0, NOTE_LIMIT)) {
        lines.push(
          `- "${group.title}" — ${group.candidateCount} in this run, ${group.referenceCount} in the reference` +
            (group.preExisting ? " (recurring)" : " (new)")
        );
      }
      if (verdict.groups.length > NOTE_LIMIT) {
        lines.push(`- …and ${verdict.groups.length - NOTE_LIMIT} more`);
      }
    }
  }

  lines.push(
    "",
    `Checked with the JSON Data Drift Analyzer v${context.appVersion} under policy ` +
      `${context.profileLabel} v${context.profileVersion}` +
      (context.policyHash ? ` (hash ${context.policyHash.slice(0, 8)}…)` : "") +
      ".",
    "Comparison only — no records were changed and no hold was released by this tool."
  );

  return lines.join("\n");
}
