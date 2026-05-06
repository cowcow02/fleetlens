"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";

const STORAGE_KEY = "cclens:changelog-last-seen";

export function ChangelogIcon({ latestVersion, active }: { latestVersion: string | null; active: boolean }) {
  // Render no dot until after mount — server can't read localStorage and we
  // don't want hydration mismatch flashes.
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    if (!latestVersion) {
      setUnread(false);
      return;
    }
    try {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      setUnread(seen !== latestVersion);
    } catch {
      setUnread(false);
    }
  }, [latestVersion]);

  return (
    <Link
      href="/changelog"
      aria-label={unread ? "Changelog (new entries)" : "Changelog"}
      title={unread ? `What's new in v${latestVersion}` : "Changelog"}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 6,
        color: active ? "var(--af-text)" : "var(--af-text-tertiary)",
        background: active ? "var(--af-surface-hover)" : "transparent",
        textDecoration: "none",
      }}
    >
      <Megaphone size={14} />
      {unread && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#ef4444",
            border: "1.5px solid var(--af-surface)",
          }}
        />
      )}
    </Link>
  );
}
