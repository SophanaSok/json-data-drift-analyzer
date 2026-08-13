import { useState } from "react";
import { deleteProfileOverride, putProfileOverride } from "../../db";
import { findProfileContradictions, findRegisteredProfileContradictions } from "../../profiles";
import { resolveEffectiveProfile } from "../../profiles/resolve";
import type { ProfileOverrideDelta } from "../../profiles/schema";
import { useProfileOverrideStore } from "../../stores/profile-override-store";
import { useToastStore } from "../../stores/toast-store";
import { OverrideEditor } from "./OverrideEditor";
import { diffProfiles } from "./override-diff";
import { useEffectiveProfile } from "./use-effective-profile";

function FieldList({ label, fields }: { label: string; fields: string[] | undefined }) {
  return (
    <div className="text-sm">
      <span className="font-medium">{label}</span>{" "}
      <span className="text-slate-600">{fields && fields.length > 0 ? fields.join(", ") : "none"}</span>
    </div>
  );
}

/**
 * Read-mostly view of one source's resolved policy, with the local-override
 * lifecycle attached: view the diff, edit or import, export for upstreaming,
 * and reset to the repo policy.
 */
export function ProfileDetail({ profileId }: { profileId: string }) {
  const { profile, repoProfile, override, overrideActive, overrideStale } = useEffectiveProfile(profileId);
  const notifyOverridesChanged = useProfileOverrideStore((state) => state.notifyOverridesChanged);
  const showToast = useToastStore((state) => state.showToast);
  const [editing, setEditing] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  if (!profile || !repoProfile) {
    return <p className="p-4 text-sm text-slate-500">Unknown profile.</p>;
  }

  const diff = overrideActive ? diffProfiles(resolveEffectiveProfile(repoProfile, null).profile, profile) : [];

  const saveOverride = async (delta: ProfileOverrideDelta, reason: string): Promise<string[] | null> => {
    const candidate = {
      profileId: repoProfile.id,
      revision: (override?.revision ?? 0) + 1,
      baseVersion: repoProfile.version,
      delta,
      reason,
      updatedAt: new Date().toISOString()
    };
    // Coherence is judged on the MERGED result: a delta is harmless-looking in
    // isolation and can still empty a key or contradict a lane assignment.
    const merged = resolveEffectiveProfile(repoProfile, candidate).profile;
    const problems = [...findProfileContradictions(merged), ...findRegisteredProfileContradictions(merged)];
    if (problems.length > 0) {
      return problems;
    }
    try {
      await putProfileOverride(candidate);
    } catch {
      return ["The override could not be saved (storage unavailable). It is NOT in effect."];
    }
    notifyOverridesChanged();
    setEditing(false);
    showToast(`Local override rev ${candidate.revision} saved for ${repoProfile.id}.`, "info");
    return null;
  };

  const resetOverride = async () => {
    try {
      await deleteProfileOverride(repoProfile.id);
    } catch {
      showToast("The override could not be removed (storage unavailable).", "warning");
      return;
    }
    notifyOverridesChanged();
    setConfirmingReset(false);
    showToast(`Local override removed; ${repoProfile.id} follows the repo policy again.`, "info");
  };

  const exportOverride = () => {
    if (!override) return;
    const content = JSON.stringify(override, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${repoProfile.id}.override.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 p-4" data-testid="profile-detail">
      <header>
        <h3 className="text-lg font-semibold">{profile.displayName ?? profile.id}</h3>
        <p className="text-xs text-slate-500">
          <code className="rounded bg-slate-100 px-1">{profile.id}</code> · {profile.sourceUrl}
          {profile.agency ? ` · ${profile.agency}` : ""}
        </p>
        <p className="mt-1 text-xs text-slate-500" data-testid="profile-effective-version">
          Repo v{repoProfile.version}
          {overrideActive ? (
            <span className="text-amber-700"> + local override rev {profile.overrideRevision}</span>
          ) : null}{" "}
          · policy <code>{profile.policyHash.slice(0, 12)}…</code>
        </p>
      </header>

      {overrideStale && override ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="override-stale-warning">
          A local override (rev {override.revision}) was written against repo v{override.baseVersion}, but the
          repo profile is now v{repoProfile.version}. It is <strong>not applied</strong>. Review whether it still
          makes sense, re-save it against the current version, or remove it.
        </p>
      ) : null}

      <section className="space-y-1 rounded border bg-white p-3">
        <h4 className="text-sm font-semibold">Recovery policy (effective)</h4>
        <div className="text-sm">
          <span className="font-medium">Identity</span>{" "}
          <span className="text-slate-600">
            {profile.primaryKey.join(" + ")} (fallbacks: {profile.fallbackKeys.map((key) => key.join(" + ")).join("; ") || "none"};
            dedupe: {profile.dedupeKey.join(" + ")})
          </span>
        </div>
        <div className="text-sm">
          <span className="font-medium">Collection path</span> <span className="text-slate-600">{profile.collectionPath}</span>{" "}
          · <span className="font-medium">Minimum match rate</span> <span className="text-slate-600">{profile.minimumMatchRate}</span>
        </div>
        <FieldList label="Approved for backfill:" fields={profile.safeBackfillFields} />
        <FieldList label="Manual review:" fields={profile.manualReviewFields} />
        <FieldList label="Hard required:" fields={profile.hardRequiredFields} />
        <FieldList label="Excluded:" fields={profile.excludedFields} />
        <FieldList label="Rule 6 date-sensitive:" fields={profile.dateSensitiveFields} />
      </section>

      <section className="space-y-1 rounded border bg-white p-3">
        <h4 className="text-sm font-semibold">Quality analysis (effective)</h4>
        <FieldList label="Required fields:" fields={profile.quality.requiredFields} />
        <FieldList label="Identity default:" fields={profile.quality.identityDefault} />
        <div className="text-sm">
          <span className="font-medium">Field groups</span>{" "}
          <span className="text-slate-600">
            {profile.quality.fieldGroups.map((group) => `${group.name} (${group.severity})`).join("; ") || "none"}
          </span>
        </div>
      </section>

      {overrideActive && diff.length > 0 ? (
        <section className="space-y-1 rounded border border-amber-300 bg-white p-3" data-testid="override-diff">
          <h4 className="text-sm font-semibold text-amber-800">What the local override changes</h4>
          {diff.map((entry) => (
            <div key={entry.path} className="text-xs">
              <code className="rounded bg-slate-100 px-1">{entry.path}</code>{" "}
              {entry.kind === "list" ? (
                <>
                  {entry.added.length > 0 ? <span className="text-emerald-700">+{entry.added.join(", +")}</span> : null}{" "}
                  {entry.removed.length > 0 ? <span className="text-red-700">−{entry.removed.join(", −")}</span> : null}
                </>
              ) : (
                <span className="text-slate-600">
                  {JSON.stringify(entry.from)} → {JSON.stringify(entry.to)}
                </span>
              )}
            </div>
          ))}
          {override ? (
            <p className="pt-1 text-xs text-slate-500">
              Reason: {override.reason} <span className="text-slate-400">({override.updatedAt})</span>
            </p>
          ) : null}
        </section>
      ) : null}

      {editing ? (
        <OverrideEditor
          repoProfile={repoProfile}
          currentDelta={override?.delta ?? null}
          onSave={saveOverride}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            type="button"
            className="rounded border border-amber-400 px-3 py-1 text-amber-800"
            data-testid="edit-override"
            onClick={() => setEditing(true)}
          >
            {override ? "Edit local override" : "Create local override"}
          </button>
          {override ? (
            <>
              <button type="button" className="rounded border border-slate-300 px-3 py-1" data-testid="export-override" onClick={exportOverride}>
                Export override JSON
              </button>
              {confirmingReset ? (
                <span className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">
                  Remove the override and return to the repo policy?
                  <button type="button" className="font-semibold underline" data-testid="confirm-reset-override" onClick={() => void resetOverride()}>
                    Remove
                  </button>
                  <button type="button" className="underline" onClick={() => setConfirmingReset(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="rounded border border-red-300 px-3 py-1 text-red-700"
                  data-testid="reset-override"
                  onClick={() => setConfirmingReset(true)}
                >
                  Remove override
                </button>
              )}
            </>
          ) : null}
        </div>
      )}

      {profile.notes && profile.notes.length > 0 ? (
        <details className="rounded border bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium">Profile notes ({profile.notes.length})</summary>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-600">
            {profile.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
