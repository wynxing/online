import type { DisplayMode, SubtitleSegment } from "../types";

export function SubtitleContent(props: {
  segment: SubtitleSegment;
  displayMode: DisplayMode;
  fontSize?: number;
}) {
  const sourceStyle = props.fontSize ? { fontSize: `${props.fontSize * 0.75}px` } : undefined;
  const translatedStyle = props.fontSize ? { fontSize: `${props.fontSize}px` } : undefined;

  return (
    <div className="subtitle-content">
      {(props.displayMode === "source" || props.displayMode === "bilingual") && (
        <p className="source-text" style={sourceStyle}>
          {props.segment.sourceText}
        </p>
      )}
      {(props.displayMode === "translated" || props.displayMode === "bilingual") && (
        <p className="translated-text" style={translatedStyle}>
          {props.segment.translatedText}
        </p>
      )}
    </div>
  );
}
