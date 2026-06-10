import type { DisplayMode, SubtitleSegment } from "../types";
import { SubtitleContent } from "./SubtitleContent";

export function SubtitleRow(props: {
  segment: SubtitleSegment;
  displayMode: DisplayMode;
  corrected: boolean;
  fontSize?: number;
}) {
  return (
    <article className={`subtitle-row ${props.segment.status} ${props.corrected ? "flash" : ""}`}>
      <div className="subtitle-meta">
        <span>{props.segment.id}</span>
        <strong>v{props.segment.version}</strong>
        <em>{props.segment.status}</em>
      </div>
      <SubtitleContent
        segment={props.segment}
        displayMode={props.displayMode}
        fontSize={props.fontSize}
      />
    </article>
  );
}
