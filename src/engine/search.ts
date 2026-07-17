import MiniSearch from "minisearch";
import type { DiffRecord, QualityIssue } from "./types";

export type SearchDocument = {
  id: string;
  recordKey: string;
  title: string;
  bidStatus: string;
  bidType: string;
  bidUrl: string;
  changedFields: string;
  qualityText: string;
  documentText: string;
};

export const SEARCH_FIELDS = [
  "recordKey",
  "title",
  "bidStatus",
  "bidType",
  "bidUrl",
  "changedFields",
  "qualityText",
  "documentText"
] as const;

export const SEARCH_STORE_FIELDS = ["id", "recordKey"] as const;

export const SEARCH_FIELD_BOOSTS: Record<(typeof SEARCH_FIELDS)[number], number> = {
  recordKey: 3,
  title: 2,
  bidStatus: 1,
  bidType: 1,
  bidUrl: 0.5,
  changedFields: 1,
  qualityText: 0.5,
  documentText: 0.5
};

export const SEARCH_QUERY_OPTIONS = {
  prefix: true,
  boost: SEARCH_FIELD_BOOSTS
} as const;

export const SEARCH_INDEX_OPTIONS = {
  fields: [...SEARCH_FIELDS] as string[],
  storeFields: [...SEARCH_STORE_FIELDS] as string[],
  searchOptions: SEARCH_QUERY_OPTIONS
};

function compareRecordKeys(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getRecordKeyMatchTier(recordKey: string, query: string): number {
  const normalizedKey = recordKey.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  if (normalizedKey === normalizedQuery) return 3;
  if (normalizedKey.startsWith(normalizedQuery)) return 2;
  if (normalizedKey.includes(normalizedQuery)) return 1;
  return 0;
}

export function compareSearchRelevance(
  aId: string,
  bId: string,
  aScore: number,
  bScore: number,
  query: string,
  recordsById: Record<string, DiffRecord>
): number {
  const aKey = recordsById[aId]?.recordKey ?? "";
  const bKey = recordsById[bId]?.recordKey ?? "";
  const tierDiff = getRecordKeyMatchTier(bKey, query) - getRecordKeyMatchTier(aKey, query);
  if (tierDiff !== 0) return tierDiff;

  const scoreDiff = bScore - aScore;
  if (scoreDiff !== 0) return scoreDiff;

  return compareRecordKeys(aKey, bKey);
}

export function loadSearchIndex(searchIndexJson: string) {
  return MiniSearch.loadJSON<SearchDocument>(searchIndexJson, SEARCH_INDEX_OPTIONS);
}

export function searchRecordIds(
  searchIndex: MiniSearch<SearchDocument>,
  query: string,
  recordsById: Record<string, DiffRecord>,
  candidateIds?: Iterable<string>
): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const candidateSet = candidateIds ? new Set(candidateIds) : null;
  const results = searchIndex.search(trimmed, SEARCH_QUERY_OPTIONS);

  return results
    .filter((result) => !candidateSet || candidateSet.has(String(result.id)))
    .sort((a, b) =>
      compareSearchRelevance(String(a.id), String(b.id), a.score, b.score, trimmed, recordsById)
    )
    .map((result) => String(result.id));
}

export function buildSearchIndex(records: Record<string, DiffRecord>, issues: QualityIssue[]) {
  const miniSearch = new MiniSearch<SearchDocument>(SEARCH_INDEX_OPTIONS);

  const issueMap = new Map(issues.map((issue) => [issue.id, issue.title + " " + issue.description]));
  for (const record of Object.values(records)) {
    const qualityText = record.qualityIssueIds.map((id) => issueMap.get(id) ?? "").join(" ");
    const documentText = Object.values(record.documentDiffs)
      .flatMap((summary) => summary.changes)
      .map((change) => [change.documentId, change.baseline?.title, change.latest?.title, change.baseline?.hash, change.latest?.hash].filter(Boolean).join(" "))
      .join(" ");

    miniSearch.add({
      id: record.id,
      recordKey: record.recordKey,
      title: String((record.latest ?? record.baseline)?.Title ?? ""),
      bidStatus: String((record.latest ?? record.baseline)?.BidStatus ?? ""),
      bidType: String((record.latest ?? record.baseline)?.BidType ?? ""),
      bidUrl: String((record.latest ?? record.baseline)?.BidURL ?? ""),
      changedFields: record.changedFields.map((change) => change.path).join(" "),
      qualityText,
      documentText
    });
  }
  return miniSearch;
}
