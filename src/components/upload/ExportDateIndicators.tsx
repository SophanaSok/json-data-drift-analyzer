import type { DateOrderingIssue, ExportDates } from "../../engine/export-metadata";
import { formatExportDates } from "../../engine/export-metadata";

type ExportDateIndicatorsProps = {
  baselineDates: ExportDates;
  latestDates: ExportDates;
  issues?: DateOrderingIssue[];
  compact?: boolean;
};

function issueFields(issues: DateOrderingIssue[] | undefined, field: "Refreshed" | "Created"): boolean {
  return issues?.some((issue) => issue.field === field) ?? false;
}

function DateBadge({ label, value, warning }: { label: string; value?: string; warning?: boolean }) {
  if (!value) return null;

  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${warning ? "border border-amber-400 bg-amber-50 text-amber-900" : "border border-slate-200 bg-slate-50 text-slate-700"}`}>
      <span className="font-medium">{label}</span>
      <span>{value}</span>
    </span>
  );
}

export function ExportDateIndicators({ baselineDates, latestDates, issues, compact = false }: ExportDateIndicatorsProps) {
  const baselineSummary = formatExportDates(baselineDates);
  const latestSummary = formatExportDates(latestDates);
  const hasAnyDates = baselineSummary !== "No export dates found" || latestSummary !== "No export dates found";

  if (!hasAnyDates) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2 text-xs text-slate-600">
        <span>Baseline {baselineSummary}</span>
        <span>Latest {latestSummary}</span>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Export dates</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-700">Baseline</p>
          <div className="flex flex-wrap gap-2">
            <DateBadge label="Refreshed" value={baselineDates.Refreshed} warning={issueFields(issues, "Refreshed")} />
            <DateBadge label="Created" value={baselineDates.Created} warning={issueFields(issues, "Created")} />
            {!baselineDates.Refreshed && !baselineDates.Created ? <span className="text-xs text-slate-500">No export dates found</span> : null}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-700">Latest</p>
          <div className="flex flex-wrap gap-2">
            <DateBadge label="Refreshed" value={latestDates.Refreshed} warning={issueFields(issues, "Refreshed")} />
            <DateBadge label="Created" value={latestDates.Created} warning={issueFields(issues, "Created")} />
            {!latestDates.Refreshed && !latestDates.Created ? <span className="text-xs text-slate-500">No export dates found</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
