import { buildRecordInspection } from "./recovery-review-table";
import type { RecoveryReview } from "../../engine/review";

function truncate(value: string, limit = 60): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

const SOURCE_LABEL: Record<string, { text: string; className: string }> = {
  candidate: { text: "candidate", className: "bg-slate-100 text-slate-700" },
  reference_backfill: { text: "reference_backfill", className: "bg-amber-100 text-amber-900" },
  manual_override: { text: "manual_override", className: "bg-sky-100 text-sky-900" }
};

/**
 * Candidate, reference, and output side by side for one record.
 *
 * Every row states where its output value came from. A reference-derived value is
 * badged distinctly from a candidate one, so nothing in the recovered artifact can
 * be mistaken for something the candidate run actually scraped.
 */
export function RecordInspector({ review, recordKey }: { review: RecoveryReview; recordKey: string }) {
  const inspection = buildRecordInspection(review, recordKey);
  if (!inspection) return null;

  return (
    <div className="mt-2" data-testid="record-inspector">
      <p className="text-xs text-slate-500">
        candidate #{inspection.candidateIndex}
        {inspection.referenceIndex !== null ? ` · reference #${inspection.referenceIndex}` : ""} ·{" "}
        {inspection.matchStatus} · {inspection.changedFieldCount} field(s) changed
      </p>
      <table className="mt-2 w-full text-xs">
        <thead className="text-left uppercase text-slate-500">
          <tr>
            <th className="py-1">Field</th>
            <th className="py-1">Candidate</th>
            <th className="py-1">Reference</th>
            <th className="py-1">Output</th>
            <th className="py-1">Value source</th>
          </tr>
        </thead>
        <tbody>
          {inspection.rows.map((row) => {
            const label = SOURCE_LABEL[row.source] ?? SOURCE_LABEL.candidate!;
            return (
              <tr key={row.field} className={`border-t ${row.changed ? "bg-amber-50" : ""}`}>
                <td className="py-1 font-medium">{row.field}</td>
                <td className="py-1 text-slate-500">
                  {row.candidateValue === "" ? "(blank)" : truncate(row.candidateValue)}
                </td>
                <td className="py-1 text-slate-500">
                  {row.referenceValue === null ? (
                    <span className="italic text-slate-400">not compared</span>
                  ) : row.referenceValue === "" ? (
                    "(blank)"
                  ) : (
                    truncate(row.referenceValue)
                  )}
                </td>
                <td className="py-1">{row.outputValue === "" ? "(blank)" : truncate(row.outputValue)}</td>
                <td className="py-1">
                  <span className={`rounded px-2 py-0.5 ${label.className}`}>{label.text}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
