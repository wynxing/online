import { Captions } from "lucide-react";
import { useRef, useEffect, useMemo } from "react";
import type { DisplayMode, PipelineDiagnostics, SubtitleSegment } from "../types";
import { t, useLang } from "../i18n";
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
  fontSize?: number;
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
  fontSize,
}: SubtitlePanelProps) {
  const lang = useLang();
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
          <span className="eyebrow">{t("subtitlePanel.liveStream", lang)}</span>
          <h2>{t("subtitlePanel.title", lang)}</h2>
        </div>
        <Captions />
      </div>
      <div className="session-strip">
        <StatusPill
          label={t("subtitlePanel.session", lang)}
          value={activeSessionTitle ?? t("subtitlePanel.sessionNotStarted", lang)}
        />
        <StatusPill label={t("subtitlePanel.status", lang)} value={sessionStatus} />
        <StatusPill
          label={t("subtitlePanel.segmentCount", lang)}
          value={String(visibleSegments.length)}
        />
        <StatusPill
          label={t("subtitlePanel.mode", lang)}
          value={
            asrProvider === "mock"
              ? t("subtitlePanel.modeMock", lang)
              : t("subtitlePanel.modeReal", lang)
          }
        />
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
          <EmptyState
            title={t("subtitlePanel.emptyTitle", lang)}
            body={t("subtitlePanel.emptyBody", lang)}
          />
        ) : (
          visibleSegments.map((segment) => (
            <SubtitleRow
              key={segment.id}
              segment={segment}
              displayMode={displayMode}
              corrected={correctedIds.has(segment.id)}
              fontSize={fontSize}
            />
          ))
        )}
      </div>
    </div>
  );
}
