import { Link, useNavigate } from "react-router-dom";
import { percent } from "../../lib/format";
import { useUiStore } from "../../stores/ui-store";

export function OverviewPage() {
  const analysis = useUiStore((state) => state.analysis);
  const navigate = useNavigate();

  if (!analysis) {
    return <p className="p-6">Run an analysis first.</p>;
  }

  const regressions = analysis.fieldStats
    .filter((stat) => stat.populationChange < 0)
    .sort((a, b) => a.populationChange - b.populationChange)
    .slice(0, 5);

  return (
    <div className="space-y-6 p-6">
      <h2 className="text-xl font-semibold">Overview</h2>
      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded border bg-white p-3"><p className="text-xs text-slate-500">Quality gate</p><p className="text-lg font-semibold">{analysis.summary.qualityGate}</p></div>
        <button className="rounded border bg-white p-3 text-left" onClick={() => navigate("/results?tab=records&status=added")}><p className="text-xs text-slate-500">Added</p><p className="text-lg font-semibold">{analysis.summary.addedCount}</p></button>
        <button className="rounded border bg-white p-3 text-left" onClick={() => navigate("/results?tab=records&status=removed")}><p className="text-xs text-slate-500">Removed</p><p className="text-lg font-semibold">{analysis.summary.removedCount}</p></button>
        <button className="rounded border bg-white p-3 text-left" onClick={() => navigate("/results?tab=records&status=changed")}><p className="text-xs text-slate-500">Changed</p><p className="text-lg font-semibold">{analysis.summary.changedCount}</p></button>
      </section>
      <section className="rounded border bg-white p-4">
        <h3 className="font-medium">Critical quality issues</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {analysis.qualityIssues.filter((issue) => issue.severity === "critical").map((issue) => <li key={issue.id}>{issue.title}</li>)}
        </ul>
      </section>
      <section className="rounded border bg-white p-4">
        <h3 className="font-medium">Most severe population regressions</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {regressions.map((item) => <li key={item.field}>{item.field}: {percent(item.baselinePresentRate)} → {percent(item.latestPresentRate)}</li>)}
        </ul>
      </section>
      <section className="rounded border bg-white p-4">
        <h3 className="font-medium">Deterministic incident narrative</h3>
        <p className="mt-2 text-sm text-slate-700">{analysis.narrative}</p>
      </section>
      <Link className="text-sm text-sky-700 underline" to="/results?tab=records">Open records</Link>
    </div>
  );
}
