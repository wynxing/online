import { describe, it, expect } from "vitest";
import { mergeSegment } from "../subtitleState";
import type { SubtitleSegment } from "../types";

function makeSegment(overrides: Partial<SubtitleSegment> = {}): SubtitleSegment {
  return {
    id: "seg_1",
    sessionId: "session_1",
    sourceText: "hello",
    translatedText: "你好",
    status: "final",
    version: 1,
    startTime: 0,
    endTime: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("mergeSegment", () => {
  it("appends a new segment to an empty list", () => {
    const seg = makeSegment();
    const result = mergeSegment([], seg);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("seg_1");
  });

  it("appends a new segment with a different id", () => {
    const existing = makeSegment({ id: "seg_1", startTime: 0 });
    const newSeg = makeSegment({ id: "seg_2", startTime: 2 });
    const result = mergeSegment([existing], newSeg);
    expect(result).toHaveLength(2);
  });

  it("updates segment when version is higher", () => {
    const v1 = makeSegment({ id: "seg_1", version: 1, sourceText: "first" });
    const v2 = makeSegment({ id: "seg_1", version: 2, sourceText: "second" });
    const result = mergeSegment([v1], v2);
    expect(result).toHaveLength(1);
    expect(result[0].sourceText).toBe("second");
  });

  it("ignores segment when version is lower", () => {
    const v2 = makeSegment({ id: "seg_1", version: 2, sourceText: "second" });
    const v1 = makeSegment({ id: "seg_1", version: 1, sourceText: "first" });
    const result = mergeSegment([v2], v1);
    expect(result).toHaveLength(1);
    expect(result[0].sourceText).toBe("second");
  });

  it("ignores segment when version is equal", () => {
    const v1 = makeSegment({ id: "seg_1", version: 1, sourceText: "first" });
    const v1Again = makeSegment({ id: "seg_1", version: 1, sourceText: "updated" });
    const result = mergeSegment([v1], v1Again);
    expect(result[0].sourceText).toBe("first");
  });

  it("sorts segments by startTime after merge", () => {
    const seg2 = makeSegment({ id: "seg_2", startTime: 3 });
    const seg1 = makeSegment({ id: "seg_1", startTime: 1 });
    const result = mergeSegment([seg2], seg1);
    expect(result[0].startTime).toBe(1);
    expect(result[1].startTime).toBe(3);
  });
});
