import { Link, Outlet } from "react-router-dom";
import { FileOrderNotice } from "../components/layout/FileOrderNotice";
import { DateOrderingToastListener } from "../components/ui/DateOrderingToastListener";
import { Toaster } from "../components/ui/Toaster";
import { BUILD_COMMIT_SHORT } from "../lib/build-info";
import { useUiStore } from "../stores/ui-store";

export function RootLayout() {
  const reset = useUiStore((state) => state.reset);
  return (
    <>
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <Link to="/" onClick={reset} className="text-sm font-semibold text-slate-900">
          JSON Data Drift Analyzer
        </Link>
        <Link to="/" onClick={reset} className="rounded px-3 py-1 text-sm text-sky-700 hover:bg-slate-100" data-testid="new-analysis-link">
          New analysis
        </Link>
      </header>
      <FileOrderNotice />
      <Outlet />
      {/* The build identifier a "wrong numbers" report can cite. */}
      <footer className="border-t px-6 py-2 text-xs text-slate-400">
        Build <code data-testid="build-commit">{BUILD_COMMIT_SHORT}</code>
      </footer>
      <DateOrderingToastListener />
      <Toaster />
    </>
  );
}
