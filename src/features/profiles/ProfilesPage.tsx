import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PROFILE_DIAGNOSTICS, listProfiles } from "../../profiles";
import { filterProfiles } from "../upload/profile-picker-filter";
import { ProfileDetail } from "./ProfileDetail";

/**
 * Master-detail over every registered source profile: search on the left,
 * resolved policy and the local-override lifecycle on the right. Deep-linkable
 * as /profiles?id=<profileId>.
 */
export function ProfilesPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const rows = useMemo(() => listProfiles(), []);
  const matches = useMemo(() => filterProfiles(rows, query), [rows, query]);
  const selectedId = params.get("id") ?? matches[0]?.id ?? null;

  return (
    <main className="grid gap-4 p-6 md:grid-cols-[280px_1fr]" data-testid="profiles-page">
      <aside className="space-y-2">
        <h2 className="text-lg font-semibold">Profiles ({rows.length})</h2>
        <input
          className="w-full rounded border border-slate-300 p-2 text-sm"
          data-testid="profiles-search"
          placeholder="Search by name, id, or URL"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="max-h-[70vh] overflow-y-auto rounded border bg-white">
          {matches.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No profiles match.</p>
          ) : (
            matches.map((row) => (
              <button
                key={row.id}
                type="button"
                data-testid={`profiles-row-${row.id}`}
                className={`block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                  row.id === selectedId ? "bg-sky-50" : "bg-white hover:bg-slate-50"
                }`}
                onClick={() => setParams({ id: row.id })}
              >
                <span className="block truncate font-medium">{row.displayName}</span>
                <span className="block truncate text-xs text-slate-600">
                  {row.id} · v{row.version}
                </span>
              </button>
            ))
          )}
        </div>
        {PROFILE_DIAGNOSTICS.length > 0 ? (
          <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700" data-testid="profile-diagnostics">
            <p className="font-semibold">{PROFILE_DIAGNOSTICS.length} profile file(s) failed to load:</p>
            <ul className="list-inside list-disc">
              {PROFILE_DIAGNOSTICS.map((issue) => (
                <li key={issue.file}>
                  {issue.file}: {issue.problems.join(" ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
      <section className="rounded border bg-slate-50/50">
        {selectedId ? <ProfileDetail key={selectedId} profileId={selectedId} /> : <p className="p-4 text-sm text-slate-500">Select a profile.</p>}
      </section>
    </main>
  );
}
