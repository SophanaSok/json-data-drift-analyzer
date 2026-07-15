import type { FieldStats, QualityIssue } from "./types";

export function buildNarrative(issues: QualityIssue[], fieldStats: FieldStats[]): string {
  const headerIssue = issues.find((issue) => issue.id === "group-header-metadata");
  if (!headerIssue) {
    return "No major extraction incident pattern detected.";
  }

  const documentHealthy = ["BidDocuments", "BidDocumentHashes", "AddendumDocuments", "BidTabulations", "AwardDocuments"].every((field) => {
    const stat = fieldStats.find((item) => item.field === field);
    if (!stat) return true;
    return stat.baselinePresentRate - stat.latestPresentRate < 0.1;
  });

  const identityHealthy = ["BidURL", "ResourceURL"].every((field) => {
    const stat = fieldStats.find((item) => item.field === field);
    if (!stat) return true;
    return stat.baselinePresentRate - stat.latestPresentRate < 0.1;
  });

  if (documentHealthy && identityHealthy) {
    return "Bid header metadata experienced a completeness collapse while document extraction remains healthy. This indicates a summary/header parser regression rather than a complete source collection failure.";
  }

  return "Likely bid summary/header extraction failure.";
}
