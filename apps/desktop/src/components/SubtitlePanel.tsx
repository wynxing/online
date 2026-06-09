import { Captions } from "lucide-react";
import { useRef, useEffect, useMemo } from "react";
import type { DisplayMode, PipelineDiagnostics, SubtitleSegment } from "../types";
import { DiagnosticsStrip } from "./DiagnosticsStrip";
import { SubtitleRow } from "./SubtitleRow";
import { EmptyState } from "./common/EmptyState";
import { StatusPill } from "./common/StatusPill";

interface SubtitlePanelProps {
  segments: SubtitleSegment[];
  displayMode: DisplayMode;
  correctedIds: Set<string>;
  sessionStatus: string;
  activeSessionTitle: string | undefined;
  isRunning: boolean;
  asrProvider: string;
  diagnostics: PipelineDiagnostics;
  diagnosticsEnabled: boolean;
  errorLog: Array<{ code: string; message: string; time: string }>;
}

function visibleSubtitleSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  return segments.filter((segment) => !segment.supersededBy);
}

export function SubtitlePanel({
  segments,
  displayMode,
  correctedIds,
  sessionStatus,
  activeSessionTitle,
  isRunning: _isRunning,
  asrProvider,
  diagnostics,
  diagnosticsEnabled,
  errorLog,
}: SubtitlePanelProps) {
  const subtitlePaneRef = useRef<HTMLDivElement>(null);
  const visibleSegments = useMemo(() => visibleSubtitleSegments(segments), [segments]);

  useEffect(() => {
    const pane = subtitlePaneRef.current;
    if (pane) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [visibleSegments.length]);

  return (
    <div className="subtitle-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Live Stream</span>
          <h2>实时字幕</h2>
        </div>
        <Captions />
      </div>
      <div className="session-strip">
        <StatusPill label="会话" value={activeSessionTitle ?? "未启动"} />
        <StatusPill label="状态" value={sessionStatus} />
        <StatusPill label="段数" value={String(visibleSegments.length)} />
        <StatusPill label="模式" value={asrProvider === "mock" ? "Mock" : "真实"} />
      </div>
      {diagnosticsEnabled && <DiagnosticsStrip diagnostics={diagnostics} />}
      {errorLog.length > 0 && (
        <div className="error-log">
          {errorLog.slice(0, 5).map((err, i) => (
            <div key={i} className="error-entry">
              <span className="error-time">{err.time}</span>
              <span className="error-code">{err.code}</span>
              <span className="error-msg">{err.message}</span>
            </div>
          ))}
        </div>
      )}
      <div className="subtitle-list" ref={subtitlePaneRef}>
        {visibleSegments.length === 0 ? (
          <EmptyState title="等待字幕流" body="启动会话后，这里会显示实时识别、翻译和修正事件。" />
        ) : (
          visibleSegments.map((segment) => (
            <SubtitleRow
              key={segment.id}
              segment={segment}
              displayMode={displayMode}
              corrected={correctedIds.has(segment.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
