import { createBrowserRouter } from "react-router-dom";
import { ResultsShell } from "../components/layout/ResultsShell";
import { UploadPage } from "../features/upload/UploadPage";
import { RootLayout } from "./RootLayout";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    // Catches errors in the layout itself; per-route boundaries below keep the
    // header/nav alive when only a page fails.
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: "/", element: <UploadPage />, errorElement: <RouteErrorBoundary /> },
      { path: "/results", element: <ResultsShell />, errorElement: <RouteErrorBoundary /> }
    ]
  }
], { basename: import.meta.env.BASE_URL });
