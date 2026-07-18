import { createBrowserRouter } from "react-router-dom";
import { ResultsShell } from "../components/layout/ResultsShell";
import { UploadPage } from "../features/upload/UploadPage";
import { RootLayout } from "./RootLayout";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <UploadPage /> },
      { path: "/results", element: <ResultsShell /> }
    ]
  }
], { basename: import.meta.env.BASE_URL });
