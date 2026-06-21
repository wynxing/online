import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSubtitleSocket } from "../../hooks/useSubtitleSocket";
import type { SubtitleSegment } from "../../types";
import { emitTauriEvent, listenMock, unlistenMocks } from "../tauriMock";

const segment: SubtitleSegment = {
  id: "segment-1",
  sessionId: "session-1",
  sourceText: "hello",
  translatedText: "你好",
  status: "final",
  version: 1,
  startTime: 0,
  endTime: 1,
  updatedAt: "2026-06-21T00:00:00Z",
};

afterEach(() => {
  vi.useRealTimers();
});

async function renderSubscribedHook() {
  const hook = renderHook(() => useSubtitleSocket());
  await waitFor(() => expect(hook.result.current.socketStatus).toBe("connected"));
  return hook;
}

describe("useSubtitleSocket", () => {
  it("subscribes to every runtime event and updates session diagnostics", async () => {
    const hook = await renderSubscribedHook();

    expect(listenMock.mock.calls.map(([event]) => event)).toEqual([
      "session:status",
      "subtitle:segment-created",
      "subtitle:segment-updated",
      "subtitle:segment-corrected",
      "pipeline:metrics",
      "runtime:error",
    ]);

    act(() => {
      emitTauriEvent("session:status", { status: "running" });
      emitTauriEvent("pipeline:metrics", {
        stage: "asr",
        status: "finished",
        segmentId: "segment-1",
        asrDurationMs: 320,
      });
    });

    expect(hook.result.current.sessionStatus).toBe("running");
    expect(hook.result.current.diagnostics.latestSegmentId).toBe("segment-1");
    expect(hook.result.current.diagnostics.latestAsrMs).toBe(320);
  });

  it("merges created and updated subtitle events", async () => {
    const hook = await renderSubscribedHook();

    act(() => emitTauriEvent("subtitle:segment-created", segment));
    expect(hook.result.current.segments).toEqual([segment]);

    const updated = { ...segment, translatedText: "您好", version: 2 };
    act(() => emitTauriEvent("subtitle:segment-updated", updated));
    expect(hook.result.current.segments).toEqual([updated]);
  });

  it("marks corrected subtitles temporarily", async () => {
    const hook = await renderSubscribedHook();
    vi.useFakeTimers();

    const corrected = { ...segment, status: "corrected" as const, version: 2 };
    act(() => emitTauriEvent("subtitle:segment-corrected", corrected));

    expect(hook.result.current.segments).toEqual([corrected]);
    expect(hook.result.current.correctedIds.has(segment.id)).toBe(true);

    act(() => vi.advanceTimersByTime(2200));
    expect(hook.result.current.correctedIds.has(segment.id)).toBe(false);
  });

  it("records runtime errors", async () => {
    const hook = await renderSubscribedHook();

    act(() => {
      emitTauriEvent("runtime:error", {
        code: "pipeline_failed",
        message: "storage unavailable",
        recoverable: false,
      });
    });

    expect(hook.result.current.errorLog[0]).toMatchObject({
      code: "pipeline_failed",
      message: "storage unavailable",
    });
  });

  it("reports a disconnected socket when subscription fails", async () => {
    listenMock.mockRejectedValueOnce(new Error("event bus unavailable"));

    const { result } = renderHook(() => useSubtitleSocket());

    await waitFor(() => expect(result.current.socketStatus).toBe("disconnected"));
  });

  it("unsubscribes every listener on unmount", async () => {
    const hook = await renderSubscribedHook();
    expect(unlistenMocks).toHaveLength(6);

    hook.unmount();

    for (const unlisten of unlistenMocks) {
      expect(unlisten).toHaveBeenCalledOnce();
    }
  });
});
