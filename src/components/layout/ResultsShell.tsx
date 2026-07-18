import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExportDateBanner } from "./ExportDateBanner";
import { DataHealthPage } from "../../features/data-health/DataHealthPage";
import { FieldChangesPage } from "../../features/field-changes/FieldChangesPage";
import { OverviewPage } from "../../features/overview/OverviewPage";
import { RecordsPage } from "../../features/records/RecordsPage";
import { BASELINE_DATE_NEWER_TOAST_MESSAGE, getAnalysisDateOrderingIssues, hasDateOrderingIssue } from "../../engine/export-metadata";
import { useToastStore } from "../../stores/toast-store";
import { useUiStore } from "../../stores/ui-store";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "records", label: "Records" },
  { id: "field-changes", label: "Field Changes" },
  { id: "data-health", label: "Data Health" }
] as const;

export function ResultsShell() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const analysis = useUiStore((state) => state.analysis);
  const showToast = useToastStore((state) => state.showToast);
  const lastToastedAnalysisKey = useRef<string | null>(null);

  useEffect(() => {
    if (!analysis) return;
    if (lastToastedAnalysisKey.current === analysis.analysisKey) return;

    const issues = getAnalysisDateOrderingIssues(analysis.metadata);
    if (!hasDateOrderingIssue(issues)) return;

    lastToastedAnalysisKey.current = analysis.analysisKey;
    showToast(BASELINE_DATE_NEWER_TOAST_MESSAGE, "warning");
  }, [analysis, showToast]);

  return (
    <div className="mx-auto max-w-7xl">
      {analysis ? <ExportDateBanner metadata={analysis.metadata} /> : null}
      <nav className="flex gap-2 border-b bg-white px-6 py-3 text-sm">
        {tabs.map((item) => (
          <Link key={item.id} className={`rounded px-3 py-1 ${tab === item.id ? "bg-sky-100" : "hover:bg-slate-100"}`} to={`/results?${new URLSearchParams({ ...Object.fromEntries(params), tab: item.id }).toString()}`}>
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "overview" ? <OverviewPage /> : null}
      {tab === "records" ? <RecordsPage /> : null}
      {tab === "field-changes" ? <FieldChangesPage /> : null}
      {tab === "data-health" ? <DataHealthPage /> : null}
    </div>
  );
}
