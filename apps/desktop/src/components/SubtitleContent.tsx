import type { DisplayMode, SubtitleSegment } from "../types";

export function SubtitleContent(props: {
  segment: SubtitleSegment;
  displayMode: DisplayMode;
  fontSize?: number;
}) {
  const style = props.fontSize ? { fontSize: `${props.fontSize}px` } : undefined;
  return (
    <div className="subtitle-content" style={style}>
      {(props.displayMode === "source" || props.displayMode === "bilingual") && (
        <p className="source-text">{props.segment.sourceText}</p>
      )}
      {(props.displayMode === "translated" || props.displayMode === "bilingual") && (
        <p className="translated-text">{props.segment.translatedText}</p>
      )}
    </div>
  );
}
