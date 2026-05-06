"use client";

import { useEffect } from "react";
import { STORAGE_KEY } from "@/lib/changelog";

export function ChangelogMarkRead({ version }: { version: string | null }) {
  useEffect(() => {
    if (!version) return;
    window.localStorage.setItem(STORAGE_KEY, version);
  }, [version]);
  return null;
}
