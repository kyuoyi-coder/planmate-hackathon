"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "./theme-script";

/**
 * Light, dark or follow the system. The choice is kept in localStorage and
 * applied to <html> (class `light` or `dark`) by THEME_SCRIPT (theme-script.ts).
 */
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

declare global {
  interface Window {
    __planmateApplyTheme?: () => void;
  }
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
  if (window.__planmateApplyTheme) {
    window.__planmateApplyTheme();
  } else {
    const root = document.documentElement;
    const dark =
      choice === "dark" ||
      (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.remove("light", "dark");
    root.classList.add(dark ? "dark" : "light");
    root.setAttribute("data-theme-choice", choice);
  }
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme-choice"],
  });
  return () => observer.disconnect();
}

const readChoice = () =>
  (document.documentElement.getAttribute("data-theme-choice") as ThemeChoice | null) ??
  "system";
const readResolved = (): ResolvedTheme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/** The user's choice. `null` during server rendering, before it is known. */
export function useThemeChoice() {
  return useSyncExternalStore<ThemeChoice | null>(subscribe, readChoice, () => null);
}

/** The theme actually showing. Assumes light until the browser has rendered. */
export function useResolvedTheme() {
  return useSyncExternalStore<ResolvedTheme>(subscribe, readResolved, () => "light");
}
