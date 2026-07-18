import { Outlet } from "react-router-dom";
import { DateOrderingToastListener } from "../components/ui/DateOrderingToastListener";
import { Toaster } from "../components/ui/Toaster";

export function RootLayout() {
  return (
    <>
      <Outlet />
      <DateOrderingToastListener />
      <Toaster />
    </>
  );
}
