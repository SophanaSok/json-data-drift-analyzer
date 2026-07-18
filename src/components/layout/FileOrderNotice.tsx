import { parseExportDate } from "../../engine/export-metadata";
import type {
  DateOrderingIssue,
  ExportDateField,
  ExportDateInspection
} from "../../engine/types";
import { useUiStore } from "../../stores/ui-store";

const sourceLabels = {
  root: "file root",
  metadata: "metadata",
  "first-record": "first record"
} as const;

function sourceText(
  baseline: ExportDateInspection,
  latest: ExportDateInspection,
  field: ExportDateField
) {
  const baselineSource = baseline.sources[field];
  const latestSource = latest.sources[field];
  if (!baselineSource || !latestSource) return "";
  if (baselineSource === latestSource) return ` (read from ${sourceLabels[baselineSource]})`;
  return ` (baseline ${sourceLabels[baselineSource]}; latest ${sourceLabels[latestSource]})`;
}

function issueText(
  issue: DateOrderingIssue,
  baseline: ExportDateInspection,
  latest: ExportDateInspection
) {
  const baselineTime = parseExportDate(issue.baseline);
  const latestTime = parseExportDate(issue.latest);
  const relation = baselineTime === latestTime ? "is the same as" : "is newer than";
  return `${issue.field}: baseline ${issue.baseline} ${relation} latest ${issue.latest}${sourceText(baseline, latest, issue.field)}`;
}

export function FileOrderNotice() {
  const assessment = useUiStore((state) => state.fileOrderAssessment);
  if (!assessment) return null;

  if (assessment.status === "reversed") {
    return (
      <aside
        className="sticky top-0 z-40 border-b border-amber-400 bg-amber-100 px-6 py-3 text-sm text-amber-950 shadow-sm"
        data-testid="global-file-order-warning"
        role="alert"
      >
        <div className="mx-auto max-w-7xl">
          <p className="font-semibold">These files may be reversed: the baseline is not older than the latest file.</p>
          <p className="mt-1">
            You selected <span className="font-medium">{assessment.baselineFileName}</span> as baseline and{" "}
            <span className="font-medium">{assessment.latestFileName}</span> as latest.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {assessment.issues.map((issue) => (
              <li key={issue.field}>{issueText(issue, assessment.baseline, assessment.latest)}</li>
            ))}
          </ul>
          <p className="mt-1 font-medium">Swap the files for a chronological comparison, or continue only if this order is intentional.</p>
        </div>
      </aside>
    );
  }

  if (assessment.status === "unverified") {
    return (
      <aside
        className="border-b border-slate-300 bg-slate-100 px-6 py-2 text-sm text-slate-700"
        data-testid="global-file-order-unverified"
        role="status"
      >
        <p className="mx-auto max-w-7xl">
          File order could not be verified. No comparable Created or Refreshed dates were found at the file root,
          in metadata, or on the first record.
        </p>
      </aside>
    );
  }

  const field = assessment.comparableFields.includes("Created") ? "Created" : assessment.comparableFields[0];
  const baselineValue = field ? assessment.baseline.dates[field] : undefined;
  const latestValue = field ? assessment.latest.dates[field] : undefined;

  return (
    <aside
      className="border-b border-emerald-200 bg-emerald-50 px-6 py-2 text-sm text-emerald-900"
      data-testid="global-file-order-correct"
      role="status"
    >
      <p className="mx-auto max-w-7xl">
        File order looks correct
        {field && baselineValue && latestValue
          ? `: baseline ${field} ${baselineValue} is older than latest ${latestValue}${sourceText(assessment.baseline, assessment.latest, field)}.`
          : "."}
      </p>
    </aside>
  );
}
