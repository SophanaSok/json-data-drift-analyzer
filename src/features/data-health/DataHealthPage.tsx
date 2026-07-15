import { useUiStore } from "../../stores/ui-store";

export function DataHealthPage() {
  const analysis = useUiStore((state) => state.analysis);
  if (!analysis) return <p className="p-6">Run an analysis first.</p>;

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-xl font-semibold">Data Health</h2>
      <section className="rounded border bg-white p-4">
        <h3 className="font-medium">Quality issues</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {analysis.qualityIssues.map((issue) => (
            <li key={issue.id} className="rounded border p-2">
              <p className="font-medium">[{issue.severity}] {issue.title}</p>
              <p>{issue.description}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
