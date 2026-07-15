import { useNavigate } from "react-router-dom";
import { percent } from "../../lib/format";
import { useUiStore } from "../../stores/ui-store";

export function FieldChangesPage() {
  const analysis = useUiStore((state) => state.analysis);
  const navigate = useNavigate();

  if (!analysis) return <p className="p-6">Run an analysis first.</p>;

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold">Field Changes</h2>
      <table className="mt-4 w-full rounded border bg-white text-left text-sm">
        <thead><tr><th className="p-2">Field</th><th className="p-2">Changed records</th><th className="p-2">Emptied</th><th className="p-2">Restored</th><th className="p-2">Modified</th><th className="p-2">Baseline</th><th className="p-2">Latest</th><th className="p-2">Change</th><th className="p-2">Severity</th></tr></thead>
        <tbody>
          {analysis.fieldStats.map((stat) => {
            const affected = analysis.indexes.byField[stat.field]?.size ?? 0;
            const records = Object.values(analysis.recordsById).flatMap((record) => record.changedFields.filter((change) => change.path === stat.field));
            return (
              <tr key={stat.field} className="border-t hover:bg-slate-50" onClick={() => navigate(`/results?tab=records&field=${encodeURIComponent(stat.field)}`)}>
                <td className="p-2">{stat.field}</td>
                <td className="p-2">{affected}</td>
                <td className="p-2">{records.filter((item) => item.kind === "emptied").length}</td>
                <td className="p-2">{records.filter((item) => item.kind === "restored").length}</td>
                <td className="p-2">{records.filter((item) => item.kind === "modified").length}</td>
                <td className="p-2">{percent(stat.baselinePresentRate)}</td>
                <td className="p-2">{percent(stat.latestPresentRate)}</td>
                <td className="p-2">{(stat.populationChange * 100).toFixed(1)}pp</td>
                <td className="p-2">{stat.severity}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
