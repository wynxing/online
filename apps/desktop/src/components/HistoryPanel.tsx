import type { SessionRecord, SubtitleSegment } from "../types";
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
  return (
    <section className="history-grid">
      <div className="history-list">
        {sessions.length === 0 ? (
          <EmptyState title="暂无历史记录" body="停止一次会话后，最终字幕会保存到 SQLite。" />
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              className={`history-item ${selectedSessionId === session.id ? "active" : ""}`}
              onClick={() => onSelectSession(session.id)}
            >
              <strong>{session.title}</strong>
              <span>{formatDate(session.startedAt)}</span>
            </button>
          ))
        )}
      </div>
      <div className="history-detail">
        {historySegments.length === 0 ? (
          <EmptyState title="选择一条会话" body="这里会展示该会话保存下来的最终字幕和修正字幕。" />
        ) : (
          historySegments.map((segment) => (
            <SubtitleRow key={segment.id} segment={segment} displayMode="bilingual" corrected={false} />
          ))
        )}
      </div>
    </section>
  );
}
