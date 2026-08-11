import { describe, expect, it } from "vitest";
import {
  ANALYSIS_CACHE_MAX_ENTRIES,
  putAnalysisBounded,
  type AnalysesTableLike,
  type SavedAnalysis
} from "./index";
import type { AnalysisResult } from "../engine/types";

// The regression these cover: the analysis cache was write-only — no pruning, no
// quota handling anywhere. A professional running daily comparisons filled browser
// quota in weeks, after which every put failed forever with only a toast.

function entry(key: string, createdAt: string): SavedAnalysis {
  return { analysisKey: key, createdAt, result: { analysisKey: key } as unknown as AnalysisResult };
}

/** In-memory stand-in for the Dexie table, with an optional failure script. */
function fakeTable(options: { failPutTimes?: number; failWith?: unknown } = {}) {
  const rows = new Map<string, SavedAnalysis>();
  let remainingFailures = options.failPutTimes ?? 0;
  const arm = (times: number) => {
    remainingFailures = times;
  };
  const table: AnalysesTableLike = {
    put: (row) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return Promise.reject(options.failWith ?? Object.assign(new Error("quota"), { name: "QuotaExceededError" }));
      }
      rows.set(row.analysisKey, row);
      return Promise.resolve(row.analysisKey);
    },
    count: () => Promise.resolve(rows.size),
    bulkDelete: (keys) => {
      keys.forEach((key) => rows.delete(key));
      return Promise.resolve();
    },
    orderBy: () => ({
      limit: (n) => ({
        primaryKeys: () =>
          Promise.resolve(
            [...rows.values()]
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .slice(0, n)
              .map((row) => row.analysisKey)
          )
      })
    })
  };
  return { table, rows, arm };
}

describe("putAnalysisBounded", () => {
  it("keeps at most the cap, evicting the oldest entries", async () => {
    const { table, rows } = fakeTable();
    for (let index = 0; index < ANALYSIS_CACHE_MAX_ENTRIES + 3; index += 1) {
      await putAnalysisBounded(entry(`key-${index}`, `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`), table);
    }
    expect(rows.size).toBe(ANALYSIS_CACHE_MAX_ENTRIES);
    // The three oldest are gone; the newest survives.
    expect(rows.has("key-0")).toBe(false);
    expect(rows.has("key-1")).toBe(false);
    expect(rows.has("key-2")).toBe(false);
    expect(rows.has(`key-${ANALYSIS_CACHE_MAX_ENTRIES + 2}`)).toBe(true);
  });

  it("evicts everything and retries once when the write hits quota", async () => {
    const { table, rows, arm } = fakeTable();
    await putAnalysisBounded(entry("old", "2026-01-01T00:00:00Z"), table);
    expect(rows.has("old")).toBe(true);

    arm(1);
    await putAnalysisBounded(entry("new", "2026-02-01T00:00:00Z"), table);
    // The full cache was evicted to make room; the new entry landed.
    expect(rows.has("new")).toBe(true);
    expect(rows.has("old")).toBe(false);
  });

  it("recognizes a Dexie-wrapped quota error by its inner name", async () => {
    const wrapped = Object.assign(new Error("wrapped"), { name: "DexieError", inner: { name: "QuotaExceededError" } });
    const { table, rows } = fakeTable({ failPutTimes: 1, failWith: wrapped });
    await expect(putAnalysisBounded(entry("k", "2026-01-01T00:00:00Z"), table)).resolves.toBeUndefined();
    expect(rows.has("k")).toBe(true);
  });

  it("propagates non-quota write failures untouched", async () => {
    const broken = Object.assign(new Error("db corrupt"), { name: "InvalidStateError" });
    const { table } = fakeTable({ failPutTimes: 1, failWith: broken });
    await expect(putAnalysisBounded(entry("k", "2026-01-01T00:00:00Z"), table)).rejects.toBe(broken);
  });

  it("propagates a second quota failure — the caller degrades to session-only", async () => {
    const { table } = fakeTable({ failPutTimes: 2 });
    await expect(putAnalysisBounded(entry("k", "2026-01-01T00:00:00Z"), table)).rejects.toMatchObject({
      name: "QuotaExceededError"
    });
  });
});
