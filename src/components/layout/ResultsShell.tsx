import { Link, useSearchParams } from "react-router-dom";
import { DataHealthPage } from "../../features/data-health/DataHealthPage";
import { FieldChangesPage } from "../../features/field-changes/FieldChangesPage";
import { OverviewPage } from "../../features/overview/OverviewPage";
import { RecordsPage } from "../../features/records/RecordsPage";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "records", label: "Records" },
  { id: "field-changes", label: "Field Changes" },
  { id: "data-health", label: "Data Health" }
] as const;

export function ResultsShell() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "overview";

  return (
    <div className="mx-auto max-w-7xl">
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
