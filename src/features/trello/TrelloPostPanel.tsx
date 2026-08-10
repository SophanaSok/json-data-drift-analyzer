import { useEffect, useMemo, useState } from "react";
import {
  findExistingPost,
  runFingerprint,
  unresolvedAttempts,
  type PostedTicketRecord,
  type TrelloTarget
} from "./trello-ticket";
import { describeOutcome, postCard, type TrelloPostResult } from "../../lib/trello";
import type { TicketDraft } from "../../engine/ticketTemplate";
import type { RecoveryReview } from "../../engine/review";

export type TrelloPostPanelProps = {
  review: RecoveryReview;
  draft: TicketDraft;
  analysisKey: string;
  /** Previous attempts for this run, loaded by the caller. */
  records: PostedTicketRecord[];
  target: TrelloTarget | null;
  onSaveTarget: (target: TrelloTarget) => void;
  onRecordAttempt: (record: PostedTicketRecord) => void;
  /** Injectable so tests never touch the network. */
  postImpl?: typeof postCard;
  /** Injectable so records are deterministic in tests. */
  now?: () => string;
};

/**
 * Post the reviewed ticket to Trello, once, after an explicit confirmation.
 *
 * Nothing here posts automatically. The confirm control appears only after the user
 * arms it, and it is the last thing between the draft and the network.
 *
 * The token lives in component state for the session and is never persisted: this app
 * is served from a shared GitHub Pages origin, where localStorage is readable by any
 * other project page on the same account. See docs/trello-integration.proposed.md.
 */
export function TrelloPostPanel({
  review,
  draft,
  analysisKey,
  records,
  target,
  onSaveTarget,
  onRecordAttempt,
  postImpl = postCard,
  now = () => new Date().toISOString()
}: TrelloPostPanelProps) {
  const [apiKey, setApiKey] = useState(target?.apiKey ?? "");
  const [listId, setListId] = useState(target?.listId ?? "");
  const [token, setToken] = useState("");
  const [armed, setArmed] = useState(false);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<TrelloPostResult | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [overrideDuplicate, setOverrideDuplicate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void runFingerprint(review, draft).then((value) => {
      if (!cancelled) setFingerprint(value);
    });
    return () => {
      cancelled = true;
    };
  }, [review, draft]);

  const existing = useMemo(
    () => (fingerprint ? findExistingPost(records, fingerprint) : { duplicate: false as const }),
    [records, fingerprint]
  );
  const unresolved = useMemo(
    () => (fingerprint ? unresolvedAttempts(records, fingerprint) : []),
    [records, fingerprint]
  );

  const configured = apiKey.trim().length > 0 && token.trim().length > 0 && listId.trim().length > 0;
  const blockedByDuplicate = existing.duplicate && !overrideDuplicate;

  const confirmAndPost = async () => {
    if (!fingerprint || posting) return;
    setPosting(true);
    try {
      const outcome = await postImpl(
        { listId, name: draft.title, description: draft.markdownDescription },
        { apiKey, token }
      );
      setResult(outcome);
      setArmed(false);

      onRecordAttempt({
        id: `post:${fingerprint}:${now()}`,
        runFingerprint: fingerprint,
        analysisKey,
        status: outcome.status === "created" ? "success" : outcome.status === "failed" ? "failed" : "unknown",
        profileId: review.profileId,
        profileVersion: review.profileVersion,
        sourceRun: review.sourceRun,
        referenceRun: review.referenceRun,
        title: draft.title,
        descriptionSha256: fingerprint,
        severity: draft.severity,
        labelsSuggested: draft.suggestedLabels,
        listId,
        cardId: outcome.status === "created" ? outcome.cardId : null,
        cardUrl: outcome.status === "created" ? outcome.cardUrl : null,
        attemptedAt: now(),
        actor: "user",
        errorCategory: outcome.status === "created" ? null : outcome.category,
        errorMessage: outcome.status === "created" ? null : outcome.message
      });

      if (outcome.status === "created") {
        // Only the non-secret half is ever persisted.
        onSaveTarget({ id: "trello-target", apiKey, listId });
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="rounded border bg-white p-4" data-testid="trello-panel">
      <h3 className="font-medium">Post to Trello</h3>
      <p className="mt-1 text-xs text-slate-500">
        Creates one card from the draft below, after you confirm. Nothing is posted
        automatically, and no file is uploaded — only the title and description.
      </p>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <label className="text-xs">
          <span className="font-medium">API key</span>
          <input
            className="mt-1 w-full rounded border border-slate-300 p-1"
            data-testid="trello-key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label className="text-xs">
          <span className="font-medium">Token</span>
          <input
            type="password"
            className="mt-1 w-full rounded border border-slate-300 p-1"
            data-testid="trello-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <label className="text-xs">
          <span className="font-medium">List ID</span>
          <input
            className="mt-1 w-full rounded border border-slate-300 p-1"
            data-testid="trello-list"
            value={listId}
            onChange={(event) => setListId(event.target.value)}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500" data-testid="token-notice">
        The token is kept in memory for this session only and is never saved — this app
        shares an origin with every other project page on the same GitHub account, so
        stored credentials would be readable by them. Re-enter it next time.
      </p>

      {existing.duplicate ? (
        <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-2 text-xs" data-testid="duplicate-warning">
          <p className="text-amber-900">
            This exact report was already posted on {existing.attemptedAt}.{" "}
            {existing.cardUrl ? (
              <a className="underline" href={existing.cardUrl} target="_blank" rel="noreferrer">
                Open the card
              </a>
            ) : null}
          </p>
          {!overrideDuplicate ? (
            <button
              className="mt-2 rounded border px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
              data-testid="duplicate-override"
              onClick={() => setOverrideDuplicate(true)}
            >
              Post again anyway
            </button>
          ) : (
            <p className="mt-1 font-medium text-amber-900">Duplicate protection overridden for this run.</p>
          )}
        </div>
      ) : null}

      {unresolved.length > 0 ? (
        <p className="mt-3 rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-900" data-testid="unresolved-warning">
          {unresolved.length} earlier attempt(s) for this report ended without a known
          outcome. Check the board before posting, or you may create a duplicate.
        </p>
      ) : null}

      <div className="mt-3 rounded border bg-slate-50 p-3" data-testid="trello-preview">
        <p className="text-xs text-slate-500">This is exactly what will be sent.</p>
        <p className="mt-2 text-sm font-medium" data-testid="preview-title">
          {draft.title}
        </p>
        <p className="mt-1 text-xs">
          <span className="text-slate-500">Severity:</span> {draft.severity}
        </p>
        <p className="mt-1 text-xs" data-testid="preview-labels">
          <span className="text-slate-500">Labels:</span> {draft.suggestedLabels.join(", ")}
          <span className="text-slate-500"> — suggestions only; no label is applied to the card.</span>
        </p>
        <pre
          className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs"
          data-testid="preview-body"
        >
          {draft.markdownDescription}
        </pre>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!armed ? (
          <button
            className="rounded border px-3 py-1 text-sm text-sky-700 hover:bg-slate-100 disabled:text-slate-400"
            data-testid="trello-arm"
            disabled={!configured || blockedByDuplicate || posting}
            onClick={() => setArmed(true)}
          >
            Post this card…
          </button>
        ) : (
          <div className="rounded border border-amber-400 bg-amber-50 p-2" data-testid="trello-confirm">
            <p className="text-xs text-amber-900">
              Create one card in list <code>{listId}</code> with the title and description
              above? This tool cannot delete a card it creates.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded border border-amber-500 px-2 py-1 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                data-testid="trello-confirm-post"
                disabled={posting}
                onClick={() => void confirmAndPost()}
              >
                {posting ? "Posting…" : "Yes, create the card"}
              </button>
              <button
                className="rounded border px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                data-testid="trello-cancel"
                disabled={posting}
                onClick={() => setArmed(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {!configured ? (
          <span className="text-xs text-slate-500" data-testid="trello-not-configured">
            Enter an API key, token, and list id to enable posting.
          </span>
        ) : null}
      </div>

      {result ? (
        <div
          className={`mt-3 rounded border p-2 text-xs ${
            result.status === "created"
              ? "border-emerald-400 bg-emerald-50 text-emerald-900"
              : "border-red-400 bg-red-50 text-red-900"
          }`}
          data-testid="trello-result"
        >
          <p className="font-medium">{describeOutcome(result)}</p>
          {result.status === "created" && result.cardUrl ? (
            <a className="underline" href={result.cardUrl} target="_blank" rel="noreferrer" data-testid="card-link">
              {result.cardUrl}
            </a>
          ) : null}
          {result.status !== "created" ? <p className="mt-1">{result.message}</p> : null}
          {result.status !== "created" ? (
            <p className="mt-1 text-slate-700">The draft above is unchanged and can be posted again.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
