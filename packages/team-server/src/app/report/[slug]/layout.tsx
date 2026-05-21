import "../../globals.css";
import type { ReactNode } from "react";

// Standalone layout used by the PDF report. It deliberately skips the
// team-server masthead + shell-nav so the captured PDF only contains the
// report content. The root layout.tsx still wraps html/body.
export default function ReportLayout({ children }: { children: ReactNode }) {
  return <main className="report-shell">{children}</main>;
}
