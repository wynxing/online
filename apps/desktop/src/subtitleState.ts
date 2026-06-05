import type { SubtitleSegment } from "./types";

export function mergeSegment(
  current: SubtitleSegment[],
  next: SubtitleSegment,
): SubtitleSegment[] {
  const index = current.findIndex((segment) => segment.id === next.id);
  if (index === -1) {
    return [...current, next].sort((a, b) => a.startTime - b.startTime);
  }
  if (current[index].version >= next.version) {
    return current;
  }
  const updated = [...current];
  updated[index] = next;
  return updated.sort((a, b) => a.startTime - b.startTime);
}
