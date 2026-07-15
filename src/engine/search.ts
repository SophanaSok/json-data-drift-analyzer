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

export function buildSearchIndex(records: Record<string, DiffRecord>, issues: QualityIssue[]) {
  const miniSearch = new MiniSearch<SearchDocument>({
    fields: ["recordKey", "title", "bidStatus", "bidType", "bidUrl", "changedFields", "qualityText", "documentText"],
    storeFields: ["id"]
  });

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
