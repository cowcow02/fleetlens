"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "cclens-team:changelog-last-seen";

export function ChangelogNavLink({ latestVersion }: { latestVersion: string | null }) {
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
    <a href="/changelog" style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
      <span>Changelog</span>
      {unread && (
        <span
          aria-label="new entries"
          style={{
            display: "inline-block",
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--accent)",
          }}
        />
      )}
    </a>
  );
}
