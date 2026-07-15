import { createBrowserRouter } from "react-router-dom";
import { ResultsShell } from "../components/layout/ResultsShell";
import { UploadPage } from "../features/upload/UploadPage";

export const router = createBrowserRouter([
  { path: "/", element: <UploadPage /> },
  { path: "/results", element: <ResultsShell /> }
], { basename: import.meta.env.BASE_URL });
