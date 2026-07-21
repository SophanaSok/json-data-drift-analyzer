import Dexie, { type Table } from "dexie";
import type { AnalysisResult } from "../engine/types";

export type SavedAnalysis = {
  analysisKey: string;
  createdAt: string;
  result: AnalysisResult;
};

export type TextDiffCache = {
  id: string;
  baselineLength: number;
  latestLength: number;
};

class DriftDatabase extends Dexie {
  analyses!: Table<SavedAnalysis, string>;
  textDiffs!: Table<TextDiffCache, string>;

  constructor() {
    super("json-data-drift-analyzer");
    this.version(1).stores({
      analyses: "analysisKey, createdAt",
      profiles: "id",
      textDiffs: "id"
    });
    this.version(2).stores({
      analyses: "analysisKey, createdAt",
      textDiffs: "id"
    });
  }
}

export const db = new DriftDatabase();
