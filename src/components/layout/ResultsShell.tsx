import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExportDateBanner } from "./ExportDateBanner";
import { DataHealthPage } from "../../features/data-health/DataHealthPage";
import { FieldChangesPage } from "../../features/field-changes/FieldChangesPage";
import { OverviewPage } from "../../features/overview/OverviewPage";
import { RecordsPage } from "../../features/records/RecordsPage";
import { db } from "../../db";
import { useToastStore } from "../../stores/toast-store";
import { useUiStore } from "../../stores/ui-store";

// Lazy: this tab pulls in the export engine and the source profile, which nothing
// else on the results screen needs. Keeping it out of the initial chunk holds the
// main bundle under the size warning.
const RecoveryReviewPage = lazy(() =>
  import("../../features/recovery/RecoveryReviewPage").then((module) => ({ default: module.RecoveryReviewPage }))
);

const ContractorTicketPage = lazy(() =>
  import("../../features/ticket/ContractorTicketPage").then((module) => ({ default: module.ContractorTicketPage }))
);

// Lazy for the same reason: the field explorer pulls in the decisions engine
// and the profile registry.
const FieldsPage = lazy(() =>
  import("../../features/fields/FieldsPage").then((module) => ({ default: module.FieldsPage }))
);

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "records", label: "Records" },
  { id: "field-changes", label: "Field Changes" },
  { id: "explore", label: "Explore" },
  { id: "data-health", label: "Data Health" },
  { id: "recovery", label: "Recovery" },
  { id: "ticket", label: "Ticket" }
] as const;

export function ResultsShell() {
  const [params] = useSearchParams();
  const requestedTab = params.get("tab") ?? "overview";
  // A mistyped or stale ?tab= must not render an empty shell.
  const tab = tabs.some((item) => item.id === requestedTab) ? requestedTab : "overview";
  const analysis = useUiStore((state) => state.analysis);
  const reset = useUiStore((state) => state.reset);
  const setAnalysis = useUiStore((state) => state.setAnalysis);
  const setReview = useUiStore((state) => state.setReview);
  const showToast = useToastStore((state) => state.showToast);
  // "restoring" until the cache answers, so a refresh shows a restore message
  // instead of flashing "Run an analysis first" while IndexedDB is read.
  const [restore, setRestore] = useState<"idle" | "restoring" | "empty">(() => (analysis ? "idle" : "restoring"));

  // The store is memory-only, so F5 used to lose everything despite the cache
  // holding the full result. With no analysis in memory, hydrate the most
  // recent cached run instead of stranding the user on empty tabs.
  useEffect(() => {
    if (analysis) return;
    let cancelled = false;
    void db.analyses
      .orderBy("createdAt")
      .last()
      .then((saved) => {
        if (cancelled) return;
        if (!saved) {
          setRestore("empty");
          return;
        }
        setAnalysis(saved.result);
        setReview(saved.review ?? null);
        setRestore("idle");
        showToast("Restored the most recent analysis from browser cache.", "info");
      })
      .catch(() => {
        if (!cancelled) setRestore("empty");
      });
    return () => {
      cancelled = true;
    };
  }, [analysis, setAnalysis, setReview, showToast]);

  if (!analysis && restore === "restoring") {
    return <p className="p-6 text-sm text-slate-600">Restoring the last analysis…</p>;
  }

  // Focus mode is the record queue's single-task view; the run-level export
  // dates are context for the run, not for the record being decided, and they
  // are what pushes the decision rows below the fold.
  const focusMode = params.get("focus") === "1";

  return (
    <div className="mx-auto max-w-7xl">
      {analysis && !focusMode ? <ExportDateBanner metadata={analysis.metadata} /> : null}
      <nav className="flex items-center justify-between border-b bg-white px-6 py-3 text-sm">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <Link key={item.id} className={`rounded px-3 py-1 ${tab === item.id ? "bg-sky-100" : "hover:bg-slate-100"}`} to={`/results?${new URLSearchParams({ ...Object.fromEntries(params), tab: item.id }).toString()}`}>
              {item.label}
            </Link>
          ))}
        </div>
        <Link to="/" onClick={reset} className="rounded px-3 py-1 text-sky-700 hover:bg-slate-100" data-testid="start-new-analysis-link">
          Start new analysis
        </Link>
      </nav>
      {tab === "overview" ? <OverviewPage /> : null}
      {tab === "records" ? <RecordsPage /> : null}
      {tab === "field-changes" ? <FieldChangesPage /> : null}
      {tab === "explore" ? (
        <Suspense fallback={<p className="p-6 text-sm text-slate-600">Loading field explorer…</p>}>
          <FieldsPage />
        </Suspense>
      ) : null}
      {tab === "data-health" ? <DataHealthPage /> : null}
      {tab === "recovery" ? (
        <Suspense fallback={<p className="p-6 text-sm text-slate-600">Loading recovery review…</p>}>
          <RecoveryReviewPage />
        </Suspense>
      ) : null}
      {tab === "ticket" ? (
        <Suspense fallback={<p className="p-6 text-sm text-slate-600">Loading ticket draft…</p>}>
          <ContractorTicketPage />
        </Suspense>
      ) : null}
    </div>
  );
}
