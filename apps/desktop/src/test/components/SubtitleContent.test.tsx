import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubtitleContent } from "../../components/SubtitleContent";
import type { SubtitleSegment } from "../../types";

const segment: SubtitleSegment = {
  id: "seg_1",
  sessionId: "session_1",
  sourceText: "Hello world",
  translatedText: "Translated text",
  status: "final",
  version: 1,
  startTime: 0,
  endTime: 1,
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("SubtitleContent", () => {
  it("applies the configured font size to translated text", () => {
    render(<SubtitleContent segment={segment} displayMode="translated" fontSize={32} />);

    expect(screen.getByText("Translated text")).toHaveStyle({ fontSize: "32px" });
  });

  it("renders bilingual text with source text scaled smaller than translated text", () => {
    render(<SubtitleContent segment={segment} displayMode="bilingual" fontSize={32} />);

    expect(screen.getByText("Hello world")).toHaveStyle({ fontSize: "24px" });
    expect(screen.getByText("Translated text")).toHaveStyle({ fontSize: "32px" });
  });
});
