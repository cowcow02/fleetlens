import "./globals.css";

export const metadata = {
  title: "Fleetlens",
  description: "Team observability for Claude Code fleets.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
