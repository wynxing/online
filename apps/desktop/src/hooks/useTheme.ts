import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

function getSystemPreference(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemPreference() : theme;
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;

  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function useTheme(): {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    return stored ?? "system";
  });

  const resolvedTheme = resolveTheme(theme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  const cycleTheme = useCallback(() => {
    const order: Theme[] = ["light", "dark", "system"];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]);
  }, [theme, setTheme]);

  // Apply on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system preference changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return { theme, resolvedTheme, setTheme, cycleTheme };
}
