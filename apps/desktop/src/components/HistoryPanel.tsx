import type { SessionRecord, SubtitleSegment } from "../types";
import { t, useLang } from "../i18n";
import { SubtitleRow } from "./SubtitleRow";
import { EmptyState } from "./common/EmptyState";
import { formatDate } from "../utils/format";

interface HistoryPanelProps {
  sessions: SessionRecord[];
  selectedSessionId: string;
  historySegments: SubtitleSegment[];
  onSelectSession: (sessionId: string) => void;
}

export function HistoryPanel({
  sessions,
  selectedSessionId,
  historySegments,
  onSelectSession,
}: HistoryPanelProps) {
  const lang = useLang();
  return (
    <section className="history-grid">
      <div className="history-list">
        {sessions.length === 0 ? (
          <EmptyState title={t("history.emptyTitle", lang)} body={t("history.emptyBody", lang)} />
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              className={`history-item ${selectedSessionId === session.id ? "active" : ""}`}
              onClick={() => onSelectSession(session.id)}
            >
              <strong>{session.title}</strong>
              <span>{formatDate(session.startedAt, lang)}</span>
            </button>
          ))
        )}
      </div>
      <div className="history-detail">
        {historySegments.length === 0 ? (
          <EmptyState
            title={t("history.detailEmptyTitle", lang)}
            body={t("history.detailEmptyBody", lang)}
          />
        ) : (
          historySegments.map((segment) => (
            <SubtitleRow
              key={segment.id}
              segment={segment}
              displayMode="bilingual"
              corrected={false}
            />
          ))
        )}
      </div>
    </section>
  );
}
