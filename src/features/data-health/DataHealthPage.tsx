import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriagePanel } from "./AlertTriagePanel";
import { IngestionProxyPanel } from "./IngestionProxyPanel";
import { buildIngestionProxies } from "./ingestion-proxies";
import {
  buildHealthSections,
  countHealthItems,
  DEFAULT_HEALTH_FILTER,
  filterHealthSections,
  HEALTH_SEVERITY_ORDER,
  isHealthFilterActive,
  type HealthFilter,
  type HealthItem,
  type HealthSeverity
} from "./data-health-model";
import { useTriageVerdict } from "./use-triage-verdict";
import { useEffectiveProfile } from "../profiles/use-effective-profile";
import { useUiStore } from "../../stores/ui-store";

/**
 * What is wrong with this run, worst first.
 *
 * Both engines' signals land here in one severity order, because a reviewer asking
 * "is this run healthy?" should not have to know which engine raised what. Per-cell
 * evidence stays where it can be acted on — the row links there rather than
 * reprinting thousands of findings the Recovery tab already lists.
 */

const SEVERITY_CHIP: Record<HealthSeverity, string> = {
  critical: "bg-red-100 text-red-900",
  high: "bg-amber-100 text-amber-900",
  medium: "bg-sky-100 text-sky-900",
  low: "bg-slate-100 text-slate-700",
  info: "bg-slate-100 text-slate-600"
};

function HealthRow({ item }: { item: HealthItem }) {
  return (
    <li className="rounded border bg-white p-3" data-testid={`health-item-${item.id}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_CHIP[item.severity]}`}>
          {item.severity}
        </span>
        <p className="font-medium">{item.title}</p>
        <span className="text-xs text-slate-500" data-testid={`health-count-${item.id}`}>
          {item.count.toLocaleString()} {item.count === 1 ? "record/finding" : "records/findings"}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-700">{item.detail}</p>
      {item.fields.length > 0 ? (
        <p className="mt-2 flex flex-wrap gap-1 text-xs">
          {item.fields.map((field) => (
            <Link
              key={field}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-sky-700 underline hover:bg-sky-50"
              data-testid={`issue-field-link-${field}`}
              to={`/results?tab=explore&field=${encodeURIComponent(field)}`}
            >
              {field}
            </Link>
          ))}
        </p>
      ) : null}
      {item.link ? (
        <Link className="mt-2 inline-block text-sm text-sky-700 underline" to={item.link.to}>
          {item.link.label}
        </Link>
      ) : null}
    </li>
  );
}

export function DataHealthPage() {
  const analysis = useUiStore((state) => state.analysis);
  const review = useUiStore((state) => state.review);
  const triage = useTriageVerdict();
  const { profile } = useEffectiveProfile(review?.profileId ?? null);
  const [filter, setFilter] = useState<HealthFilter>(DEFAULT_HEALTH_FILTER);

  const sections = useMemo(() => (analysis ? buildHealthSections(analysis, review) : []), [analysis, review]);
  // Proxies walk both sides of every record, so they are memoized on the run.
  const proxies = useMemo(() => (analysis ? buildIngestionProxies(analysis, profile) : null), [analysis, profile]);
  const visible = useMemo(() => filterHealthSections(sections, filter), [sections, filter]);

  if (!analysis) {
    return (
      <div className="space-y-3 p-6">
        <h2 className="text-xl font-semibold">Data Health</h2>
        <p className="text-sm text-slate-600">
          No run loaded. Load a reference and a candidate export to see this run's health.
        </p>
        <Link className="text-sm text-sky-700 underline" to="/">
          Start a new analysis
        </Link>
      </div>
    );
  }

  const total = countHealthItems(sections);
  const shown = countHealthItems(visible);

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-xl font-semibold">Data Health</h2>

      {triage ? <AlertTriagePanel verdict={triage.verdict} note={triage.note} showGroups /> : null}

      {proxies ? <IngestionProxyPanel report={proxies} /> : null}

      <section className="rounded border bg-white p-4" data-testid="health-sections">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium">Run health</h3>
          <p className="text-xs text-slate-500" data-testid="health-count">
            Showing {shown} of {total}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            <span className="text-xs text-slate-500">Severity</span>
            <select
              className="rounded border border-slate-300 p-1"
              data-testid="health-filter-severity"
              value={filter.severity}
              onChange={(event) =>
                setFilter((current) => ({ ...current, severity: event.target.value as HealthFilter["severity"] }))
              }
            >
              <option value="all">All</option>
              {HEALTH_SEVERITY_ORDER.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1">
            <span className="text-xs text-slate-500">Search</span>
            <input
              className="rounded border border-slate-300 p-1"
              data-testid="health-filter-search"
              placeholder="title, detail, or field"
              value={filter.search}
              onChange={(event) => setFilter((current) => ({ ...current, search: event.target.value }))}
            />
          </label>

          {isHealthFilterActive(filter) ? (
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              data-testid="health-filter-clear"
              onClick={() => setFilter(DEFAULT_HEALTH_FILTER)}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {total === 0 ? (
          <p className="mt-3 text-sm text-slate-600" data-testid="health-empty">
            Neither engine raised anything for this run.
          </p>
        ) : null}

        {total > 0 && shown === 0 ? (
          <p className="mt-3 text-sm text-slate-600" data-testid="health-no-matches">
            No health item matches this filter.
          </p>
        ) : null}

        <div className="mt-3 space-y-4">
          {visible.map((section) => (
            <div key={section.severity} data-testid={`health-section-${section.severity}`}>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {section.severity} · {section.items.length}
              </h4>
              <ul className="mt-2 space-y-2">
                {section.items.map((item) => (
                  <HealthRow key={item.id} item={item} />
                ))}
              </ul>
            </div>
          ))}
        </div>

        {review === null ? (
          <p className="mt-4 text-xs text-slate-500" data-testid="health-no-review">
            This run has no recovery review, so only the drift engine's issues are listed. Run the analysis with a
            source profile to include QA findings.
          </p>
        ) : null}
      </section>
    </div>
  );
}
