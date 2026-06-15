import type { Lang } from "../i18n";

export function formatDate(value: string, lang: Lang): string {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatMs(value?: number): string {
  if (typeof value !== "number") {
    return "-";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}s`;
  }
  return `${Math.round(value)}ms`;
}
