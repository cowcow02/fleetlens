"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Boolean state that persists to localStorage and stays in sync across
 * any components using the same key — including within the same window.
 *
 * Standard storage events only fire in *other* windows, so we also
 * dispatch a custom event on every write and listen for it here so
 * sibling components (e.g. the main-page toggle and the sidebar widget)
 * update together without a refresh.
 *
 * Returns [value, setValue, hydrated]:
 *   - hydrated is false on the first SSR pass and on the first client
 *     render before useEffect runs; use it to avoid flicker on mount.
 */
export function usePersistentBoolean(
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void, boolean] {
  const [value, setValue] = useState<boolean>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  // Read initial value on mount
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === "1") setValue(true);
      else if (stored === "0") setValue(false);
    } catch {
      // localStorage blocked — stick with default
    }
    setHydrated(true);
  }, [key]);

  // Subscribe to changes from other components/tabs
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string; value?: boolean } | undefined;
      if (detail?.key !== key) return;
      if (typeof detail.value === "boolean") setValue(detail.value);
    };
    const storageHandler = (e: StorageEvent) => {
      if (e.key !== key) return;
      if (e.newValue === "1") setValue(true);
      else if (e.newValue === "0") setValue(false);
    };
    window.addEventListener("cclens:persistent-boolean", handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener("cclens:persistent-boolean", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [key]);

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // ignore
      }
      window.dispatchEvent(
        new CustomEvent("cclens:persistent-boolean", {
          detail: { key, value: next },
        }),
      );
    },
    [key],
  );

  return [value, update, hydrated];
}
