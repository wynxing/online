import type { DisplayMode, Tab } from "../types";

export function modeLabel(mode: DisplayMode): string {
  return (
    {
      source: "原文",
      translated: "译文",
      bilingual: "双语",
    }[mode] ?? mode
  );
}

export function tabTitle(tab: Tab): string {
  return (
    {
      console: "实时同传控制台",
      settings: "运行时与 AI 设置",
      history: "会话历史",
      glossary: "术语表管理",
    }[tab] ?? tab
  );
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
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
