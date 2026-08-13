import type { CellCorroboration } from "../../engine/corroboration";

/**
 * The advisory signal, shown as evidence rather than a verdict.
 *
 * Rule 5 confines a fuzzy signal to identifying review candidates, so the
 * wording never asserts the reference value is wrong — only that the text the
 * candidate run still has says something different, and here is the sentence.
 * The person judges which one is stale.
 */
export function CorroborationNote({ corroboration }: { corroboration: CellCorroboration | undefined }) {
  if (!corroboration || corroboration.verdict === "no_signal") return null;

  const disagrees = corroboration.verdict === "not_corroborated";
  const evidence = corroboration.evidence[0];

  return (
    <details
      className={`mt-0.5 rounded px-1.5 py-0.5 text-[11px] ${
        disagrees ? "bg-amber-50 text-amber-900 ring-1 ring-amber-300" : "bg-emerald-50 text-emerald-900"
      }`}
      data-testid={`corroboration-${corroboration.field}`}
      data-verdict={corroboration.verdict}
    >
      <summary className="cursor-pointer list-none">
        {disagrees ? "⚠ the record's own text says a different date" : "✓ the record's own text agrees"}
      </summary>
      {evidence ? (
        <p className="mt-1 border-l-2 border-current/30 pl-2 italic">
          {evidence.sourceField}: “{evidence.quote}”
        </p>
      ) : null}
      {disagrees ? (
        <p className="mt-1">
          One of the two is out of date — an extended deadline leaves the old text behind, a stale reference leaves
          the new text behind. This flag does not say which; read the sentence and decide.
        </p>
      ) : null}
    </details>
  );
}
