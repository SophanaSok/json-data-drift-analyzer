import { Outlet } from "react-router-dom";
import { Toaster } from "../components/ui/Toaster";

export function RootLayout() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}
