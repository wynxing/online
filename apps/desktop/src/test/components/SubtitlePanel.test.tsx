import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SubtitlePanel } from "../../components/SubtitlePanel";
import type { SubtitleSegment, PipelineDiagnostics } from "../../types";

const emptyDiagnostics: PipelineDiagnostics = { droppedCount: 0, lowEnergyDrops: 0 };

function makeSegment(overrides: Partial<SubtitleSegment> = {}): SubtitleSegment {
  return {
    id: "seg_1",
    sessionId: "session_1",
    sourceText: "Hello world",
    translatedText: "你好世界",
    status: "final",
    version: 1,
    startTime: 0,
    endTime: 1,
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultProps = {
  segments: [],
  displayMode: "bilingual" as const,
  correctedIds: new Set<string>(),
  sessionStatus: "idle",
  activeSessionTitle: undefined as string | undefined,
  isRunning: false,
  asrProvider: "mock",
  diagnostics: emptyDiagnostics,
  diagnosticsEnabled: false,
  errorLog: [],
};

function renderPanel(overrides = {}) {
  return render(<SubtitlePanel {...defaultProps} {...overrides} />);
}

describe("SubtitlePanel", () => {
  it("renders empty state when no segments", () => {
    renderPanel();
    expect(screen.getByText("等待字幕流")).toBeInTheDocument();
  });

  it("renders segments", () => {
    const segments = [makeSegment({ id: "seg_1", sourceText: "Hello" })];
    renderPanel({ segments });
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders session status strip", () => {
    renderPanel({ sessionStatus: "running", activeSessionTitle: "Test Session" });
    expect(screen.getByText("Test Session")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("shows '未启动' when no active session", () => {
    renderPanel();
    expect(screen.getByText("未启动")).toBeInTheDocument();
  });

  it("filters out superseded segments", () => {
    const segments = [
      makeSegment({ id: "seg_1", supersededBy: "seg_2", sourceText: "Old text" }),
      makeSegment({ id: "seg_2", sourceText: "Current text" }),
    ];
    renderPanel({ segments });
    expect(screen.queryByText("Old text")).not.toBeInTheDocument();
    expect(screen.getByText("Current text")).toBeInTheDocument();
  });

  it("shows error log entries", () => {
    const errorLog = [
      { code: "E001", message: "Connection failed", time: "12:00:00" },
    ];
    renderPanel({ errorLog });
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
    expect(screen.getByText("E001")).toBeInTheDocument();
  });

  it("limits error log to 5 entries", () => {
    const errorLog = Array.from({ length: 8 }, (_, i) => ({
      code: `E${i}`,
      message: `Error ${i}`,
      time: "12:00:00",
    }));
    renderPanel({ errorLog });
    const errorEntries = screen.getAllByText(/Error/);
    expect(errorEntries).toHaveLength(5);
  });

  it("shows ASR mode as Mock", () => {
    renderPanel({ asrProvider: "mock" });
    expect(screen.getByText("Mock")).toBeInTheDocument();
  });

  it("shows ASR mode as 真实", () => {
    renderPanel({ asrProvider: "openai-compatible" });
    expect(screen.getByText("真实")).toBeInTheDocument();
  });
});
