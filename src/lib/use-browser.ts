"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** true after hydration (avoids server/client markup mismatch). */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/** navigator.onLine as React state, updated by the browser's online/offline events. */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** A boolean flag persisted in localStorage (per-viewer convenience only). */
export function useStoredFlag(key: string): [boolean, (v: boolean) => void] {
  const event = `jj-flag:${key}`;
  const value = useSyncExternalStore(
    (cb) => {
      window.addEventListener(event, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(event, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(key) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const set = (v: boolean) => {
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* storage blocked: flag is not remembered */
    }
    window.dispatchEvent(new Event(event));
  };
  return [value, set];
}
