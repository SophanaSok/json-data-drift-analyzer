import type { BidDocument, DocumentChange, DocumentDiffSummary } from "./types";

export type DocumentHealth = {
  missingHashCount: number;
  missingTitleCount: number;
  missingUrlCount: number;
  duplicateHashes: string[];
  missingInHashList: string[];
  danglingHashListValues: string[];
};

function toText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getCaseInsensitive(record: Record<string, unknown>, key: string): unknown {
  for (const [k, value] of Object.entries(record)) {
    if (k.toLowerCase() === key.toLowerCase()) {
      return value;
    }
  }
  return undefined;
}

export function normalizeDocuments(value: unknown): BidDocument[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      title: toText(getCaseInsensitive(item, "title")),
      url: toText(getCaseInsensitive(item, "url")),
      hash: toText(getCaseInsensitive(item, "hash"))
    }));
}

export function compareDocuments(
  baselineRaw: unknown,
  latestRaw: unknown,
  baselineHashesRaw: unknown,
  latestHashesRaw: unknown
): { summary: DocumentDiffSummary; health: DocumentHealth } {
  const baselineDocs = normalizeDocuments(baselineRaw);
  const latestDocs = normalizeDocuments(latestRaw);

  const baselineByHash = new Map<string, BidDocument>();
  const latestByHash = new Map<string, BidDocument>();

  const changes: DocumentChange[] = [];
  const duplicates: string[] = [];
  const seenBaselineHashes = new Set<string>();
  const seenLatestHashes = new Set<string>();

  let missingHashCount = 0;
  let missingTitleCount = 0;
  let missingUrlCount = 0;

  for (const doc of [...baselineDocs, ...latestDocs]) {
    if (!doc.hash) {
      missingHashCount += 1;
      changes.push({
        documentId: `incomplete-${changes.length + 1}`,
        kind: "incomplete",
        baseline: baselineDocs.includes(doc) ? doc : undefined,
        latest: latestDocs.includes(doc) ? doc : undefined,
        changedFields: ["hash"]
      });
    }
    if (!doc.title) missingTitleCount += 1;
    if (!doc.url) missingUrlCount += 1;
  }

  for (const doc of baselineDocs) {
    if (!doc.hash) continue;
    if (seenBaselineHashes.has(doc.hash)) duplicates.push(doc.hash);
    seenBaselineHashes.add(doc.hash);
    baselineByHash.set(doc.hash, doc);
  }

  for (const doc of latestDocs) {
    if (!doc.hash) continue;
    if (seenLatestHashes.has(doc.hash)) duplicates.push(doc.hash);
    seenLatestHashes.add(doc.hash);
    latestByHash.set(doc.hash, doc);
  }

  for (const [hash, baselineDoc] of baselineByHash) {
    const latestDoc = latestByHash.get(hash);
    if (!latestDoc) {
      changes.push({ documentId: hash, kind: "removed", baseline: baselineDoc, changedFields: ["hash"] });
      continue;
    }
    const changedFields: Array<"title" | "url" | "hash"> = [];
    if (baselineDoc.title !== latestDoc.title) changedFields.push("title");
    if (baselineDoc.url !== latestDoc.url) changedFields.push("url");
    if (changedFields.length > 0) {
      changes.push({ documentId: hash, kind: "modified", baseline: baselineDoc, latest: latestDoc, changedFields });
    }
  }

  for (const [hash, latestDoc] of latestByHash) {
    if (baselineByHash.has(hash)) continue;
    changes.push({ documentId: hash, kind: "added", latest: latestDoc, changedFields: ["hash"] });
  }

  const baselineHashes = Array.isArray(baselineHashesRaw) ? baselineHashesRaw.map((value) => String(value)) : [];
  const latestHashes = Array.isArray(latestHashesRaw) ? latestHashesRaw.map((value) => String(value)) : [];

  const missingInHashList = [...new Set([...baselineByHash.keys(), ...latestByHash.keys()])].filter(
    (hash) => !baselineHashes.includes(hash) && !latestHashes.includes(hash)
  );
  const danglingHashListValues = [...new Set([...baselineHashes, ...latestHashes])].filter(
    (hash) => !baselineByHash.has(hash) && !latestByHash.has(hash)
  );

  const summary: DocumentDiffSummary = {
    baselineCount: baselineDocs.length,
    latestCount: latestDocs.length,
    addedCount: changes.filter((change) => change.kind === "added").length,
    removedCount: changes.filter((change) => change.kind === "removed").length,
    modifiedCount: changes.filter((change) => change.kind === "modified").length,
    incompleteCount: changes.filter((change) => change.kind === "incomplete").length,
    unchangedCount: Math.max(Math.min(baselineByHash.size, latestByHash.size) - changes.filter((change) => change.kind === "modified").length, 0),
    changes
  };

  return {
    summary,
    health: {
      missingHashCount,
      missingTitleCount,
      missingUrlCount,
      duplicateHashes: [...new Set(duplicates)],
      missingInHashList,
      danglingHashListValues
    }
  };
}
