import { createContext, useContext } from "react";
import en from "./en";
import zh from "./zh";

export type Lang = "zh" | "en";

const messages: Record<Lang, Record<string, string>> = { zh, en };

export function t(key: string, lang: Lang): string {
  return messages[lang]?.[key] ?? key;
}

export function detectLang(): Lang {
  const stored = window.localStorage.getItem("lang") as Lang | null;
  if (stored === "zh" || stored === "en") return stored;
  const nav = navigator.language;
  return nav.startsWith("zh") ? "zh" : "en";
}

const LangContext = createContext<Lang>("zh");

export const LangProvider = LangContext.Provider;

export function useLang(): Lang {
  return useContext(LangContext);
}
