/**
 * Proxies for the pipeline's "batch ingestion issue" alert.
 *
 * That alert fires when an unusual share of a batch's records reach
 * preclassification, and the export carries no field marking which records those
 * were — so this run cannot be triaged the way the duplicate-title alert can. What
 * the export does carry is the shape of the data that feeds ingestion, and a batch
 * that suddenly needs more processing usually looks different in that shape: text
 * gone missing, a categorical field drifting, document payloads no longer parsing.
 *
 * These are proxies and are labelled as such. They report measured shares side by
 * side and stop there: no threshold is invented, no verdict is implied, and a shift
 * here is a lead to investigate rather than evidence of the alert's cause.
 *
 * Every field examined comes from the source profile that already names it for
 * another purpose — the corroboration text fields, the search roles for status and
 * type, the configured JSON fields and document pairs — so this module holds no
 * source field names of its own (AGENTS.md rule 1) and a newly onboarded source
 * gets its proxies without any code change.
 */

import { baselineSnapshot } from "../../engine/diff";
import { isEmpty } from "../../engine/empty";
import type { AnalysisResult, EmptyRule } from "../../engine/types";
import type { RegisteredSourceProfile } from "../../engine/adapter-types";

export type ProxyKind = "text-loss" | "distribution" | "json-validity";

/** One value's share of a categorical field, on both sides. */
export type ProxyValueShare = {
  value: string;
  /** True for the synthetic row counting records with no value at all. */
  isMissing: boolean;
  referenceCount: number;
  candidateCount: number;
  referenceShare: number;
  candidateShare: number;
  /** candidateShare - referenceShare. */
  shift: number;
};

export type IngestionProxy = {
  id: string;
  kind: ProxyKind;
  field: string;
  title: string;
  /** What is being measured, in one sentence. */
  measure: string;
  referenceShare: number;
  candidateShare: number;
  /** candidateShare - referenceShare; positive always means "more of it now". */
  delta: number;
  referenceBase: number;
  candidateBase: number;
  /** Populated for distribution proxies, largest absolute movement first. */
  values: ProxyValueShare[];
};

export type IngestionProxyReport = {
  proxies: IngestionProxy[];
  referenceRecordCount: number;
  candidateRecordCount: number;
  /** Fields the profile named for these proxies; empty means none was configured. */
  configuredFields: string[];
};

/** Distinct values beyond which a field is treated as free text, not a category. */
const CATEGORICAL_LIMIT = 25;
/** Value rows shown per distribution proxy. */
const VALUE_LIMIT = 8;

type SideCounts = {
  base: number;
  empty: number;
  invalidJson: number;
  values: Map<string, number>;
};

const emptySide = (): SideCounts => ({ base: 0, empty: 0, invalidJson: 0, values: new Map() });

function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function isJsonParsable(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function tally(side: SideCounts, value: unknown, rule: EmptyRule | undefined, track: "values" | "json" | "none"): void {
  side.base += 1;
  if (isEmpty(value, rule)) {
    side.empty += 1;
    return;
  }
  if (track === "values") {
    const key = typeof value === "string" ? value.trim() : JSON.stringify(value);
    side.values.set(key, (side.values.get(key) ?? 0) + 1);
  } else if (track === "json" && !isJsonParsable(value)) {
    side.invalidJson += 1;
  }
}

/** Fields the profile already names, mapped to what makes each one worth watching. */
function proxyFields(profile: RegisteredSourceProfile): Array<{ field: string; kind: ProxyKind }> {
  const seen = new Set<string>();
  const fields: Array<{ field: string; kind: ProxyKind }> = [];
  const add = (field: string | undefined, kind: ProxyKind) => {
    if (!field || seen.has(field)) return;
    seen.add(field);
    fields.push({ field, kind });
  };

  // Text whose absence is what the corroboration signal reads; losing it is the
  // clearest "this record arrived thinner than usual" signal the export has.
  for (const field of profile.corroboration?.textFields ?? []) add(field, "text-loss");

  // The two search roles that are categorical by construction.
  add(profile.quality.searchSourceFields.status, "distribution");
  add(profile.quality.searchSourceFields.type, "distribution");

  // Document payloads: JSON-encoded strings whose parseability is a hard fact.
  for (const field of profile.validation?.jsonFields ?? []) add(field, "json-validity");
  for (const pair of profile.quality.documentFieldPairs) {
    add(pair.docs, "json-validity");
    add(pair.hashes, "json-validity");
  }

  return fields;
}

const MISSING_LABEL = "(no value)";

function valueShare(
  value: string,
  isMissing: boolean,
  referenceCount: number,
  candidateCount: number,
  reference: SideCounts,
  candidate: SideCounts
): ProxyValueShare {
  const referenceShare = share(referenceCount, reference.base);
  const candidateShare = share(candidateCount, candidate.base);
  return {
    value,
    isMissing,
    referenceCount,
    candidateCount,
    referenceShare,
    candidateShare,
    shift: candidateShare - referenceShare
  };
}

/**
 * Per-value shares, including a row for records carrying no value at all.
 *
 * Records with nothing in the field are the ingestion-relevant part of a
 * categorical field's shape — a run that wiped the field would otherwise show
 * every real value falling to zero with nothing accounting for where they went —
 * so blankness is a row here rather than a separate measure, and the shares add
 * up to the whole run.
 */
function buildValueShares(reference: SideCounts, candidate: SideCounts): ProxyValueShare[] {
  const values = new Set([...reference.values.keys(), ...candidate.values.keys()]);
  const shares = [...values].map((value) =>
    valueShare(value, false, reference.values.get(value) ?? 0, candidate.values.get(value) ?? 0, reference, candidate)
  );

  if (reference.empty > 0 || candidate.empty > 0) {
    shares.push(valueShare(MISSING_LABEL, true, reference.empty, candidate.empty, reference, candidate));
  }

  return shares.sort(
    (left, right) => Math.abs(right.shift) - Math.abs(left.shift) || right.candidateCount - left.candidateCount
  );
}

/**
 * Measure every configured proxy across both sides of the run.
 *
 * Reference-side counts cover every record with a baseline (unchanged, changed,
 * removed); candidate-side counts cover every record with a latest side. Both are
 * whole-run shares, which is what makes them comparable when the record count
 * itself moved.
 */
export function buildIngestionProxies(
  analysis: AnalysisResult,
  profile: RegisteredSourceProfile | null
): IngestionProxyReport {
  const fields = profile ? proxyFields(profile) : [];
  const emptyRules = profile?.quality.emptyRules ?? {};

  const reference = new Map(fields.map((entry) => [entry.field, emptySide()]));
  const candidate = new Map(fields.map((entry) => [entry.field, emptySide()]));
  let referenceRecordCount = 0;
  let candidateRecordCount = 0;

  for (const id of analysis.allRecordIds) {
    const record = analysis.recordsById[id];
    if (!record) continue;
    const latest = record.latest;
    const baseline = baselineSnapshot(record);
    if (baseline) referenceRecordCount += 1;
    if (latest) candidateRecordCount += 1;

    for (const { field, kind } of fields) {
      const track = kind === "distribution" ? "values" : kind === "json-validity" ? "json" : "none";
      const rule = emptyRules[field];
      if (baseline) tally(reference.get(field)!, baseline[field], rule, track);
      if (latest) tally(candidate.get(field)!, latest[field], rule, track);
    }
  }

  const proxies: IngestionProxy[] = [];
  for (const { field, kind } of fields) {
    const referenceSide = reference.get(field)!;
    const candidateSide = candidate.get(field)!;

    if (kind === "distribution") {
      const values = buildValueShares(referenceSide, candidateSide);
      // Distinctness is judged on real values: the missing row is a presence
      // measure, not one of the categories that make a field free text.
      const distinct = values.filter((entry) => !entry.isMissing).length;
      // A free-text field has no distribution worth reading; its emptiness does.
      const asDistribution = distinct > 0 && distinct <= CATEGORICAL_LIMIT;
      if (asDistribution) {
        const moved = values[0];
        proxies.push({
          id: `proxy:${field}:distribution`,
          kind,
          field,
          title: `${field} distribution`,
          measure: `Share of each ${field} value, reference run against this one.`,
          // The headline is the largest single movement, so a stable field reads
          // as flat rather than as an arbitrary value's share.
          referenceShare: moved?.referenceShare ?? 0,
          candidateShare: moved?.candidateShare ?? 0,
          delta: moved?.shift ?? 0,
          referenceBase: referenceSide.base,
          candidateBase: candidateSide.base,
          values: values.slice(0, VALUE_LIMIT)
        });
        continue;
      }
    }

    if (kind === "json-validity") {
      proxies.push({
        id: `proxy:${field}:json`,
        kind,
        field,
        title: `${field} not parsable as JSON`,
        measure: `Share of populated ${field} values that fail JSON.parse.`,
        referenceShare: share(referenceSide.invalidJson, referenceSide.base - referenceSide.empty),
        candidateShare: share(candidateSide.invalidJson, candidateSide.base - candidateSide.empty),
        delta:
          share(candidateSide.invalidJson, candidateSide.base - candidateSide.empty) -
          share(referenceSide.invalidJson, referenceSide.base - referenceSide.empty),
        referenceBase: referenceSide.base - referenceSide.empty,
        candidateBase: candidateSide.base - candidateSide.empty,
        values: []
      });
      continue;
    }

    proxies.push({
      id: `proxy:${field}:empty`,
      kind: "text-loss",
      field,
      title: `${field} missing`,
      measure: `Share of records with no ${field}.`,
      referenceShare: share(referenceSide.empty, referenceSide.base),
      candidateShare: share(candidateSide.empty, candidateSide.base),
      delta: share(candidateSide.empty, candidateSide.base) - share(referenceSide.empty, referenceSide.base),
      referenceBase: referenceSide.base,
      candidateBase: candidateSide.base,
      values: []
    });
  }

  return {
    // Biggest movement first: the reader is looking for what changed.
    proxies: proxies.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta)),
    referenceRecordCount,
    candidateRecordCount,
    configuredFields: fields.map((entry) => entry.field)
  };
}

/** Proxies whose share actually moved between the runs. */
export function movedProxies(report: IngestionProxyReport): IngestionProxy[] {
  return report.proxies.filter((proxy) => proxy.delta !== 0);
}
