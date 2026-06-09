import type { DisplayMode, SubtitleSegment } from "../types";

export function SubtitleContent(props: { segment: SubtitleSegment; displayMode: DisplayMode }) {
  return (
    <div className="subtitle-content">
      {(props.displayMode === "source" || props.displayMode === "bilingual") && (
        <p className="source-text">{props.segment.sourceText}</p>
      )}
      {(props.displayMode === "translated" || props.displayMode === "bilingual") && (
        <p className="translated-text">{props.segment.translatedText}</p>
      )}
    </div>
  );
}
