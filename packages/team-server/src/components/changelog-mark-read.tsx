"use client";

import { useEffect } from "react";

const STORAGE_KEY = "cclens-team:changelog-last-seen";

export function ChangelogMarkRead({ version }: { version: string | null }) {
  useEffect(() => {
    if (!version) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, version);
    } catch {
      // ignore
    }
  }, [version]);
  return null;
}
