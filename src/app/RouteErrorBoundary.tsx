import { Component, type ErrorInfo, type ReactNode } from "react";
import { useRouteError } from "react-router-dom";

/**
 * Failure surface for render/route errors.
 *
 * Two shapes share the same panel:
 * - `RouteErrorBoundary` — the router's `errorElement`, catching render errors and
 *   lazy-chunk load failures inside a route (a stale index.html after a redeploy
 *   used to blank the whole app here).
 * - `AppErrorBoundary` — a class boundary above the router, so an error outside
 *   any route still shows a recovery path instead of a white page.
 *
 * The in-memory analysis is lost either way; the panel is honest about that and
 * offers the two actions that always work: reload, or start over.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected error occurred.";
}

function ErrorPanel({ error }: { error: unknown }) {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-8" data-testid="error-boundary">
      <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
      <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{describeError(error)}</p>
      <p className="text-sm text-slate-600">
        If this happened right after an update, the page may be running a stale version — reloading fixes that. Any
        analysis in progress was kept only in memory and will need to be re-run.
      </p>
      <div className="flex gap-3">
        <button
          className="rounded bg-sky-600 px-4 py-2 text-sm text-white"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload page
        </button>
        <a className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700" href={import.meta.env.BASE_URL}>
          Start over
        </a>
      </div>
    </main>
  );
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  return <ErrorPanel error={error} />;
}

type AppErrorBoundaryState = { error: unknown; hasError: boolean };

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error, hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No telemetry by design; the console is the only diagnostic surface.
    console.error("Unhandled application error", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorPanel error={this.state.error} />;
    }
    return this.props.children;
  }
}
