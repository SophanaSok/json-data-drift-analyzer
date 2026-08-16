import { createBrowserRouter } from "react-router-dom";
import { ResultsShell } from "../components/layout/ResultsShell";
import { ProfilesPage } from "../features/profiles/ProfilesPage";
import { UploadPage } from "../features/upload/UploadPage";
import { NotFoundPage } from "./NotFoundPage";
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
      { path: "/results", element: <ResultsShell />, errorElement: <RouteErrorBoundary /> },
      { path: "/profiles", element: <ProfilesPage />, errorElement: <RouteErrorBoundary /> },
      // A mistyped URL is not an application error; see NotFoundPage.
      { path: "*", element: <NotFoundPage /> }
    ]
  }
], { basename: import.meta.env.BASE_URL });
