import type { QualityProfile } from "./types";

/**
 * @deprecated Quality configuration is per-source policy and lives in the
 * profile's `quality` section (src/profiles/base.json and per-source deltas);
 * derive the engine view with `toQualityProfile(resolvedProfile)`. This
 * remains only as the fallback for `runAnalysis` callers that supply no
 * profile (engine tests). base.test.ts pins it equal to base.json's quality
 * section so the two cannot drift.
 */
export const defaultProfile: QualityProfile = {
  id: "default-government-bids",
  version: 1,
  name: "Government Bids Default",
  requiredFields: ["ProjectCode", "Title", "BidURL"],
  optionalEmptyFields: ["AwardDate", "AwardedVendorName"],
  emptyRules: {
    BidDocuments: { allowEmptyArray: true },
    AddendumDocuments: { allowEmptyArray: true },
    BidTabulations: { allowEmptyArray: true },
    AwardDocuments: { allowEmptyArray: true }
  },
  identityDefault: ["ProjectCode"],
  documentFieldPairs: [
    { docs: "BidDocuments", hashes: "BidDocumentHashes" },
    { docs: "AddendumDocuments", hashes: "AddendumDocumentHashes" },
    { docs: "BidTabulations", hashes: "BidTabulationHashes" },
    { docs: "AwardDocuments", hashes: "AwardDocumentHashes" }
  ],
  searchSourceFields: { title: "Title", status: "BidStatus", type: "BidType", url: "BidURL" },
  fieldGroups: [
    {
      id: "header-metadata",
      name: "Bid header metadata",
      fields: ["Title", "BidStatus", "BidType", "PublishedDate", "DueDate", "AwardDate"],
      thresholdDrop: 0.5,
      minAffectedFields: 3,
      severity: "critical",
      narrative: "Likely bid summary/header extraction failure."
    },
    {
      id: "identity-routing",
      name: "Identity and routing",
      fields: ["ProjectCode", "BidURL", "ResourceURL"],
      thresholdDrop: 0.3,
      minAffectedFields: 2,
      severity: "high",
      narrative: "Identity and routing data quality degraded."
    },
    {
      id: "document-extraction",
      name: "Document extraction",
      fields: ["BidDocuments", "BidDocumentHashes", "AddendumDocuments", "BidTabulations", "AwardDocuments"],
      thresholdDrop: 0.3,
      minAffectedFields: 2,
      severity: "high",
      narrative: "Document extraction quality degraded."
    }
  ]
};
