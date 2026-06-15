import { useEffect, useMemo, useState } from "react";
import type { DisplayMode, SubtitleSegment } from "../types";
import { useSubtitleSocket } from "../hooks/useSubtitleSocket";
import { SubtitleContent } from "./SubtitleContent";
import { t, useLang } from "../i18n";
import { useTheme } from "../hooks/useTheme";

function visibleSubtitleSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  return segments.filter((segment) => !segment.supersededBy);
}

export function FloatingSubtitles() {
  useTheme(); // 初始化主题，使浮窗尊重用户选择的 light/dark/system
  const lang = useLang();
  const { segments, correctedIds, socketStatus } = useSubtitleSocket();
  const visibleSegments = useMemo(() => visibleSubtitleSegments(segments), [segments]);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    (window.localStorage.getItem("floatingDisplayMode") as DisplayMode) || "bilingual"
  );
  const [fontSize, setFontSize] = useState<number>(
    Number(window.localStorage.getItem("fontSize")) || 24
  );

  // 监听 localStorage 变化（主窗口修改字号时同步）
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === "fontSize" && e.newValue) {
        setFontSize(Number(e.newValue));
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  const latest = useMemo(
    () =>
      [...visibleSegments].reverse().find((segment) => segment.status !== "interim") ??
      visibleSegments[visibleSegments.length - 1],
    [visibleSegments]
  );

  useEffect(() => {
    window.localStorage.setItem("floatingDisplayMode", displayMode);
  }, [displayMode]);

  async function handleClose() {
    const tauriAvailable = "__TAURI_INTERNALS__" in window;
    if (tauriAvailable) {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const current = WebviewWindow.getCurrent();
      await current.close();
      return;
    }
    window.close();
  }

  async function handleDragStart(e: React.MouseEvent) {
    if (e.buttons !== 1) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const tauriAvailable = "__TAURI_INTERNALS__" in window;
    if (tauriAvailable) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().startDragging();
    }
  }

  return (
    <div className="floating-shell">
      <div className="floating-toolbar" onMouseDown={(e) => void handleDragStart(e)}>
        <span className={`status-dot ${socketStatus}`} />
        <span>{t("floating.title", lang)}</span>
        <div className="floating-modes">
          {(["source", "translated", "bilingual"] as DisplayMode[]).map((mode) => (
            <button
              key={mode}
              className={displayMode === mode ? "active" : ""}
              onClick={() => setDisplayMode(mode)}
            >
              {t(`controlPanel.mode.${mode}`, lang)}
            </button>
          ))}
        </div>
        <button
          className="floating-close"
          onClick={() => void handleClose()}
          title={t("floating.close", lang)}
        >
          ✕
        </button>
      </div>
      <div className={`floating-card ${latest && correctedIds.has(latest.id) ? "corrected" : ""}`}>
        {latest ? (
          <SubtitleContent segment={latest} displayMode={displayMode} fontSize={fontSize} />
        ) : (
          <span className="floating-empty">{t("floating.waitingForSession", lang)}</span>
        )}
      </div>
    </div>
  );
}
