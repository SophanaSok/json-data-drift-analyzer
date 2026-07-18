import { create } from "zustand";
import type { AnalysisResult, DateOrderingIssue, FilterState } from "../engine/types";

type UiState = {
  analysis: AnalysisResult | null;
  filter: FilterState;
  selectedRecordId: string | null;
  workerStep: string | null;
  pendingDateOrderingIssues: DateOrderingIssue[] | null;
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setFilter: (update: Partial<FilterState>) => void;
  resetFilter: () => void;
  setSelectedRecordId: (recordId: string | null) => void;
  setWorkerStep: (step: string | null) => void;
  setPendingDateOrderingIssues: (issues: DateOrderingIssue[] | null) => void;
};

const defaultFilter: FilterState = {
  status: "all",
  field: null,
  kind: "all",
  severity: "all",
  qualityIssueId: null,
  documentState: "all",
  onlyQualityFailures: false,
  hasEmptyLatest: false,
  search: ""
};

export const useUiStore = create<UiState>((set) => ({
  analysis: null,
  filter: defaultFilter,
  selectedRecordId: null,
  workerStep: null,
  pendingDateOrderingIssues: null,
  setAnalysis: (analysis) => set({ analysis }),
  setFilter: (update) => set((state) => ({ filter: { ...state.filter, ...update } })),
  resetFilter: () => set({ filter: defaultFilter }),
  setSelectedRecordId: (selectedRecordId) => set({ selectedRecordId }),
  setWorkerStep: (workerStep) => set({ workerStep }),
  setPendingDateOrderingIssues: (pendingDateOrderingIssues) => set({ pendingDateOrderingIssues })
}));
