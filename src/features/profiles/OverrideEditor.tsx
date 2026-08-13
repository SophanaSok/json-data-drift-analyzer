import { useRef, useState } from "react";
import type { RegisteredSourceProfile } from "../../engine/adapter-types";
import type { ProfileOverrideDelta } from "../../profiles/schema";
import { validateOverrideDelta } from "../../profiles/validate";

export type OverrideEditorProps = {
  /** The repo profile the override applies over. */
  repoProfile: RegisteredSourceProfile;
  /** Values the current override already sets, to seed the form. */
  currentDelta: ProfileOverrideDelta | null;
  /** Called with a validated, minimal delta and its required reason. */
  onSave: (delta: ProfileOverrideDelta, reason: string) => Promise<string[] | null>;
  onCancel: () => void;
};

/** The list fields editable inline; anything else arrives via delta import. */
const EDITABLE_LISTS = [
  "safeBackfillFields",
  "manualReviewFields",
  "excludedFields",
  "hardRequiredFields",
  "dateSensitiveFields"
] as const;
type EditableList = (typeof EDITABLE_LISTS)[number];

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Build or amend a local override as a delta over the repo profile.
 *
 * Two paths, both ending in the same validated delta: edit the field lists
 * (and match-rate threshold) inline, or import a delta JSON file for anything
 * the form does not cover. Only values that differ from the repo profile land
 * in the delta, so the export stays a minimal, reviewable amendment. The
 * reason is required — an override is a policy decision (AGENTS.md rule 7).
 */
export function OverrideEditor({ repoProfile, currentDelta, onSave, onCancel }: OverrideEditorProps) {
  const effective = (field: EditableList): string[] =>
    (currentDelta?.[field] as string[] | undefined) ?? (repoProfile[field] ?? []);
  const [lists, setLists] = useState<Record<EditableList, string>>(() => ({
    safeBackfillFields: effective("safeBackfillFields").join(", "),
    manualReviewFields: effective("manualReviewFields").join(", "),
    excludedFields: effective("excludedFields").join(", "),
    hardRequiredFields: effective("hardRequiredFields").join(", "),
    dateSensitiveFields: effective("dateSensitiveFields").join(", ")
  }));
  const [matchRate, setMatchRate] = useState(String(currentDelta?.minimumMatchRate ?? repoProfile.minimumMatchRate));
  const [imported, setImported] = useState<ProfileOverrideDelta | null>(null);
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const importDelta = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = validateOverrideDelta(parsed);
      if (!result.ok) {
        setProblems(result.problems);
        return;
      }
      setImported(result.value);
      setProblems([]);
    } catch {
      setProblems(["The selected file is not valid JSON."]);
    }
  };

  const save = async () => {
    if (reason.trim().length === 0) {
      setProblems(["A reason is required — the override is a policy decision and must be auditable."]);
      return;
    }

    // Start from the imported delta (it may carry keys the form cannot edit),
    // then overlay the form fields that differ from the repo profile.
    const delta: ProfileOverrideDelta = { ...(imported ?? {}) };
    for (const field of EDITABLE_LISTS) {
      const edited = parseCsv(lists[field]);
      if (JSON.stringify(edited) !== JSON.stringify(repoProfile[field] ?? [])) {
        delta[field] = edited;
      } else if (!(imported && field in imported)) {
        delete delta[field];
      }
    }
    const rate = Number(matchRate);
    if (!Number.isFinite(rate)) {
      setProblems(["minimumMatchRate must be a number between 0 and 1."]);
      return;
    }
    if (rate !== repoProfile.minimumMatchRate) {
      delta.minimumMatchRate = rate;
    }

    if (Object.keys(delta).length === 0) {
      setProblems(["Nothing differs from the repo profile — there is no override to save."]);
      return;
    }

    const saveProblems = await onSave(delta, reason.trim());
    if (saveProblems) {
      setProblems(saveProblems);
    }
  };

  return (
    <div className="space-y-3 rounded border border-amber-300 bg-amber-50/50 p-4" data-testid="override-editor">
      <h4 className="font-medium">Local override</h4>
      <p className="text-xs text-slate-600">
        Applies in this browser only, on top of repo v{repoProfile.version}. To make a change permanent,
        export it below and commit it into <code>src/profiles/sources/{repoProfile.id}.json</code> with a
        version bump.
      </p>
      {EDITABLE_LISTS.map((field) => (
        <label key={field} className="block text-sm">
          <span className="font-medium">{field}</span>
          <input
            className="mt-1 w-full rounded border border-slate-300 p-2 font-mono text-xs"
            data-testid={`override-${field}`}
            value={lists[field]}
            onChange={(event) => setLists((state) => ({ ...state, [field]: event.target.value }))}
          />
        </label>
      ))}
      <label className="block text-sm">
        <span className="font-medium">minimumMatchRate</span>
        <input
          className="mt-1 w-32 rounded border border-slate-300 p-2 text-xs"
          data-testid="override-minimumMatchRate"
          value={matchRate}
          onChange={(event) => setMatchRate(event.target.value)}
        />
      </label>
      <div className="text-sm">
        <button type="button" className="text-sky-700 underline" onClick={() => fileRef.current?.click()}>
          Import a delta JSON file
        </button>{" "}
        <span className="text-xs text-slate-500">
          for keys the form does not cover (keys, validation, corroboration, quality…).
          {imported ? ` Imported: ${Object.keys(imported).join(", ")}.` : ""}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          data-testid="override-import-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importDelta(file);
            event.target.value = "";
          }}
        />
      </div>
      <label className="block text-sm">
        <span className="font-medium">Reason (required)</span>
        <textarea
          className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
          data-testid="override-reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why this policy differs from the repo profile, and what evidence supports it."
        />
      </label>
      {problems.length > 0 ? (
        <ul className="list-inside list-disc rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700" data-testid="override-problems">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded bg-amber-600 px-3 py-1 text-sm text-white"
          data-testid="override-save"
          onClick={() => void save()}
        >
          Save override
        </button>
        <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
