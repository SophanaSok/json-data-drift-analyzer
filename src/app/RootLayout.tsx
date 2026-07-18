import { Outlet } from "react-router-dom";
import { FileOrderNotice } from "../components/layout/FileOrderNotice";
import { DateOrderingToastListener } from "../components/ui/DateOrderingToastListener";
import { Toaster } from "../components/ui/Toaster";

export function RootLayout() {
  return (
    <>
      <FileOrderNotice />
      <Outlet />
      <DateOrderingToastListener />
      <Toaster />
    </>
  );
}
