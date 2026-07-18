import { RouterProvider } from "react-router-dom";
import { Toaster } from "../components/ui/Toaster";
import { router } from "./router";

export function AppProviders() {
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}
