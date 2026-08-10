import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildDraftFromForm,
  EMPTY_TICKET_FORM,
  TRELLO_HANDOFF_STEPS,
  type TicketDraftForm
} from "./ticket-draft-view";
import { buildFileName, buildTicketInputFromExport, downloadArtifact } from "../../engine/export";
import { getProfile } from "../../profiles";
import { copyTextToClipboard } from "../../lib/clipboard";
import { useUiStore } from "../../stores/ui-store";
import { useToastStore } from "../../stores/toast-store";
import { TrelloPostPanel } from "../trello/TrelloPostPanel";
import type { PostedTicketRecord, TrelloTarget } from "../trello/trello-ticket";
import { db } from "../../db";

export function ContractorTicketPage() {
  const review = useUiStore((state) => state.review);
  const showToast = useToastStore((state) => state.showToast);
  const [form, setForm] = useState<TicketDraftForm>(EMPTY_TICKET_FORM);
  const [postRecords, setPostRecords] = useState<PostedTicketRecord[]>([]);
  const [trelloTarget, setTrelloTarget] = useState<TrelloTarget | null>(null);

  const analysisKey = review?.generatedAt ?? "";
  useEffect(() => {
    if (!review) return;
    let cancelled = false;
    void Promise.all([
      db.postedTickets.where("analysisKey").equals(analysisKey).toArray(),
      db.trelloTarget.get("trello-target")
    ])
      .then(([records, target]) => {
        if (cancelled) return;
        setPostRecords(records);
        setTrelloTarget(target ?? null);
      })
      .catch(() => {
        // A cache read failure must not hide the draft.
      });
    return () => {
      cancelled = true;
    };
  }, [review, analysisKey]);

  const profile = review ? getProfile(review.profileId) : null;

  const baseInput = useMemo(() => {
    if (!review || !profile) return null;
    return buildTicketInputFromExport({
      profile,
      qa: review.qa,
      recovery: review.recovery,
      dedupe: review.dedupe,
      generatedAt: review.generatedAt,
      inputHashes: review.inputHashes,
      sourceRun: review.sourceRun,
      referenceRun: review.referenceRun
    });
  }, [review, profile]);

  const result = useMemo(() => (baseInput ? buildDraftFromForm(baseInput, form) : null), [baseInput, form]);

  if (!review || !profile || !baseInput || !result) {
    return (
      <div className="space-y-3 p-6">
        <h2 className="text-xl font-semibold">Contractor ticket</h2>
        <p className="text-sm text-slate-600">
          No recovery review for this run, so there is nothing to draft a ticket from.
        </p>
        <Link className="text-sm text-sky-700 underline" to="/">
          Start a new analysis
        </Link>
      </div>
    );
  }

  const copy = (label: string, text: string) => {
    void copyTextToClipboard(text).then((copied) => {
      showToast(copied ? `${label} copied.` : `Could not copy ${label}; select and copy it manually.`, copied ? "info" : "warning");
    });
  };

  const onDownload = () => {
    if (!result.ok) return;
    const fileName = buildFileName("contractor-ticket", profile.id, review.generatedAt);
    const started = downloadArtifact({
      kind: "contractor-ticket",
      fileName,
      contentType: "text/markdown",
      content: `# ${result.draft.title}\n\n${result.draft.markdownDescription}\n`
    });
    if (!started) showToast(`Could not start the download for ${fileName}.`, "warning");
  };

  const setIdentification = (index: number, patch: Partial<{ label: string; value: string }>) => {
    setForm((current) => ({
      ...current,
      identification: current.identification.map((row, position) =>
        position === index ? { ...row, ...patch } : row
      )
    }));
  };

  return (
    <div className="space-y-6 p-6" data-testid="contractor-ticket">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Contractor ticket</h2>
        <p className="text-sm text-slate-600">
          A draft to review, copy, or post. <strong>Nothing is posted automatically</strong> — every
          card requires an explicit confirmation, and only the title and description are sent.
        </p>
      </header>

      <section className="rounded border bg-white p-4">
        <h3 className="font-medium">Optional context</h3>
        <p className="mt-1 text-xs text-slate-500">
          Everything below is optional. The draft is complete without it.
        </p>

        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">Source identification</p>
          <p className="text-xs text-slate-500">
            Rows identifying the scraper or agent, for whoever picks the ticket up. Values are
            printed verbatim, so do not put a credential here.
          </p>
          {form.identification.map((row, index) => (
            <div key={index} className="flex gap-2">
              <input
                className="w-1/3 rounded border border-slate-300 p-2 text-sm"
                placeholder="Label (e.g. Agent)"
                data-testid={`identification-label-${index}`}
                value={row.label}
                onChange={(event) => setIdentification(index, { label: event.target.value })}
              />
              <input
                className="flex-1 rounded border border-slate-300 p-2 text-sm"
                placeholder="Value"
                data-testid={`identification-value-${index}`}
                value={row.value}
                onChange={(event) => setIdentification(index, { value: event.target.value })}
              />
            </div>
          ))}
          <button
            className="rounded border px-3 py-1 text-sm text-sky-700 hover:bg-slate-100"
            data-testid="add-identification"
            onClick={() => setForm((current) => ({ ...current, identification: [...current.identification, { label: "", value: "" }] }))}
          >
            Add a row
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <label className="block text-sm font-medium" htmlFor="root-cause-evidence">
            Root-cause evidence you actually have
          </label>
          <p className="text-xs text-slate-500">
            One per line — a scraper log line, a vendor reply, a diffed response. These are quoted
            verbatim and attributed as supplied. Leave this empty and the ticket says the cause is
            not established, rather than proposing one.
          </p>
          <textarea
            id="root-cause-evidence"
            className="h-24 w-full rounded border border-slate-300 p-2 text-sm"
            data-testid="root-cause-evidence"
            value={form.rootCauseEvidence}
            onChange={(event) => setForm((current) => ({ ...current, rootCauseEvidence: event.target.value }))}
          />
        </div>
      </section>

      {result.ok ? (
        <>
          <section className="rounded border bg-white p-4" data-testid="draft-summary">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Title</p>
                <p className="font-medium" data-testid="draft-title">
                  {result.draft.title}
                </p>
              </div>
              <button
                className="rounded border px-3 py-1 text-sm text-sky-700 hover:bg-slate-100"
                data-testid="copy-title"
                onClick={() => copy("Title", result.draft.title)}
              >
                Copy title
              </button>
            </div>
            <p className="mt-3 text-sm">
              <span className="text-slate-500">Severity:</span> <strong>{result.draft.severity}</strong>
            </p>
            <p className="mt-1 text-sm">
              <span className="text-slate-500">Suggested labels:</span>{" "}
              <span data-testid="draft-labels">{result.draft.suggestedLabels.join(", ")}</span>
            </p>
          </section>

          <section className="rounded border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Description</h3>
              <div className="flex gap-2">
                <button
                  className="rounded border px-3 py-1 text-sm text-sky-700 hover:bg-slate-100"
                  data-testid="copy-description"
                  onClick={() => copy("Description", result.draft.markdownDescription)}
                >
                  Copy Markdown
                </button>
                <button
                  className="rounded border px-3 py-1 text-sm text-sky-700 hover:bg-slate-100"
                  data-testid="download-ticket"
                  onClick={onDownload}
                >
                  Download .md
                </button>
              </div>
            </div>
            <pre
              className="mt-3 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs"
              data-testid="draft-markdown"
            >
              {result.draft.markdownDescription}
            </pre>
          </section>
        </>
      ) : (
        <section className="rounded border border-red-300 bg-red-50 p-4" data-testid="draft-refused">
          <h3 className="font-medium text-red-900">Draft refused</h3>
          <p className="mt-1 text-sm text-red-900">{result.error}</p>
          <p className="mt-2 text-xs text-red-900">
            Remove the offending content and the draft will rebuild.
          </p>
        </section>
      )}

      {result.ok ? (
        <TrelloPostPanel
          review={review}
          draft={result.draft}
          analysisKey={analysisKey}
          records={postRecords}
          target={trelloTarget}
          onSaveTarget={(target) => {
            setTrelloTarget(target);
            void db.trelloTarget.put(target).catch(() => {
              showToast("Trello list saved for this session only.", "warning");
            });
          }}
          onRecordAttempt={(record) => {
            setPostRecords((current) => [...current, record]);
            void db.postedTickets.put(record).catch(() => {
              showToast("Post recorded for this session but not saved in browser storage.", "warning");
            });
          }}
        />
      ) : null}

      <section className="rounded border bg-white p-4" data-testid="trello-handoff">
        <h3 className="font-medium">Getting this into Trello</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {TRELLO_HANDOFF_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          Posting is available above and always requires an explicit confirmation. The steps below
          remain the manual route, and are still the only way to attach the exported files — the
          card carries the title and description only.
        </p>
      </section>
    </div>
  );
}
