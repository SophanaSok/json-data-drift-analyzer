import { percent } from "../../lib/format";
import type { IngestionProxy, IngestionProxyReport } from "./ingestion-proxies";

/**
 * Proxies for the pipeline's ingestion-share alert, presented as proxies.
 *
 * The export names no preclassification field, so nothing here can confirm or
 * clear that alert. What it can do is put the shape of the data that feeds
 * ingestion side by side across the two runs and let the reviewer judge. The
 * caveat is part of the panel rather than a footnote, because a number shown
 * without it would be read as an answer.
 */

function signed(delta: number): string {
  const formatted = percent(Math.abs(delta));
  if (delta === 0) return "no change";
  return `${delta > 0 ? "+" : "−"}${formatted}`;
}

function deltaClass(delta: number): string {
  if (delta === 0) return "text-slate-500";
  return delta > 0 ? "text-amber-900" : "text-slate-700";
}

function ProxyRow({ proxy }: { proxy: IngestionProxy }) {
  return (
    <li className="rounded border bg-white p-3" data-testid={`proxy-${proxy.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{proxy.title}</p>
        <p className="text-sm tabular-nums">
          <span className="text-slate-600">{percent(proxy.referenceShare)}</span>
          <span aria-hidden="true" className="mx-1 text-slate-400">
            →
          </span>
          <span className="sr-only">to</span>
          <span className="font-semibold">{percent(proxy.candidateShare)}</span>{" "}
          <span className={deltaClass(proxy.delta)} data-testid={`proxy-delta-${proxy.id}`}>
            ({signed(proxy.delta)})
          </span>
        </p>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {proxy.measure} Measured over {proxy.referenceBase.toLocaleString()} reference and{" "}
        {proxy.candidateBase.toLocaleString()} candidate values.
      </p>

      {proxy.values.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <caption className="sr-only">{proxy.field} value shares, reference run against this run</caption>
            <thead className="text-slate-500">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Value
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Reference
                </th>
                <th scope="col" className="py-1 pr-3 font-medium">
                  This run
                </th>
                <th scope="col" className="py-1 font-medium">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              {proxy.values.map((value) => (
                <tr key={value.value} className="border-t">
                  <td className={`py-1 pr-3 ${value.isMissing ? "italic text-slate-500" : ""}`}>{value.value}</td>
                  <td className="py-1 pr-3 tabular-nums text-slate-600">{percent(value.referenceShare)}</td>
                  <td className="py-1 pr-3 tabular-nums">{percent(value.candidateShare)}</td>
                  <td className={`py-1 tabular-nums ${deltaClass(value.shift)}`}>{signed(value.shift)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}

export function IngestionProxyPanel({ report }: { report: IngestionProxyReport }) {
  return (
    <section className="rounded border bg-white p-4" data-testid="ingestion-proxies">
      <h3 className="font-medium">Ingestion-share proxies</h3>
      <p className="mt-1 text-xs text-slate-600">
        The pipeline's other alert fires when an unusual share of a batch reaches preclassification. This export
        carries no field marking which records those were, so <strong>none of these numbers measures that alert</strong>
        . They are proxies: the shape of the data ingestion reads, this run against the reference run. A movement here
        is a lead to investigate, not a cause — and no threshold is applied, because none has been established for this
        source.
      </p>

      {report.proxies.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600" data-testid="proxies-unconfigured">
          This run's profile names no text, categorical, or document fields, so there is nothing to compare.
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-slate-500" data-testid="proxies-scope">
            {report.referenceRecordCount.toLocaleString()} reference records against{" "}
            {report.candidateRecordCount.toLocaleString()} in this run, over{" "}
            {report.configuredFields.length} field{report.configuredFields.length === 1 ? "" : "s"} the profile already
            names.
          </p>
          <ul className="mt-3 space-y-2">
            {report.proxies.map((proxy) => (
              <ProxyRow key={proxy.id} proxy={proxy} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
