import { Link, Outlet } from "react-router-dom";
import { FileOrderNotice } from "../components/layout/FileOrderNotice";
import { DateOrderingToastListener } from "../components/ui/DateOrderingToastListener";
import { Toaster } from "../components/ui/Toaster";
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
      <DateOrderingToastListener />
      <Toaster />
    </>
  );
}
