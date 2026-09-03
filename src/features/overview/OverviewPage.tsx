import { Link } from "react-router-dom";
import { AlertTriagePanel } from "../data-health/AlertTriagePanel";
import { useTriageVerdict } from "../data-health/use-triage-verdict";
import { percent } from "../../lib/format";
import { useUiStore } from "../../stores/ui-store";

/**
 * Tiles are real links, not buttons that navigate: a link can be middle-clicked
 * into a new tab, copied, and reached by link navigation — all things a QC
 * reviewer juggling several filtered views actually does.
 */
function TileLink({ to, label, value, testid }: { to: string; label: string; value: string | number; testid: string }) {
  return (
    <Link className="block rounded border bg-white p-3 text-left hover:bg-slate-50" to={to} data-testid={testid}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </Link>
  );
}

export function OverviewPage() {
  const analysis = useUiStore((state) => state.analysis);
  // Hooks run before the early return: an analysis-less page still has to obey
  // the rules of hooks.
  const triage = useTriageVerdict();

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
      {/* The alert that put the run on hold is the reason the analyst opened this
          screen, so its verdict sits above the tiles rather than a tab away. */}
      {triage ? <AlertTriagePanel verdict={triage.verdict} note={triage.note} /> : null}
      <section className="grid gap-3 md:grid-cols-4">
        {/* The gate verdict is explained on the Recovery tab, so that is where the tile goes. */}
        <TileLink to="/results?tab=recovery" label="Quality gate" value={analysis.summary.qualityGate} testid="tile-quality-gate" />
        <TileLink to="/results?tab=records&status=added" label="Added" value={analysis.summary.addedCount} testid="tile-added" />
        <TileLink to="/results?tab=records&status=removed" label="Removed" value={analysis.summary.removedCount} testid="tile-removed" />
        <TileLink to="/results?tab=records&status=changed" label="Changed" value={analysis.summary.changedCount} testid="tile-changed" />
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
