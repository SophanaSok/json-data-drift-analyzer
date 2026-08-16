import { Link } from "react-router-dom";

/**
 * Catch-all for unknown paths. Without it, a mistyped URL falls through to the
 * router's error boundary and reads as an application crash — and the GitHub
 * Pages 404.html fallback makes every unknown path on the deployed site land
 * here rather than on GitHub's own error page.
 */
export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-xl space-y-4 p-8" data-testid="not-found">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-slate-700">There is no page at this address.</p>
      <Link className="text-sm text-sky-700 underline" to="/">
        Go to the upload page
      </Link>
    </main>
  );
}
