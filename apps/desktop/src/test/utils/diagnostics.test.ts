import { describe, it, expect } from "vitest";
import { reduceDiagnostics, emptyDiagnostics } from "../../utils/diagnostics";
import type { PipelineMetricsPayload } from "../../types";

describe("emptyDiagnostics", () => {
  it("has zeroed counters", () => {
    expect(emptyDiagnostics.droppedCount).toBe(0);
    expect(emptyDiagnostics.lowEnergyDrops).toBe(0);
  });
});

describe("reduceDiagnostics", () => {
  it("updates latestSegmentId", () => {
    const metrics: PipelineMetricsPayload = {
      segmentId: "seg_123",
      stage: "audio",
      status: "started",
    };
    const result = reduceDiagnostics(emptyDiagnostics, metrics);
    expect(result.latestSegmentId).toBe("seg_123");
  });

  it("updates ASR duration on finished asr stage", () => {
    const metrics: PipelineMetricsPayload = {
      stage: "asr",
      status: "finished",
      asrDurationMs: 450,
    };
    const result = reduceDiagnostics(emptyDiagnostics, metrics);
    expect(result.latestAsrMs).toBe(450);
  });

  it("updates translation duration on finished translation stage", () => {
    const metrics: PipelineMetricsPayload = {
      stage: "translation",
      status: "finished",
      translationDurationMs: 300,
      endToEndMs: 800,
    };
    const result = reduceDiagnostics(emptyDiagnostics, metrics);
    expect(result.latestTranslationMs).toBe(300);
    expect(result.latestEndToEndMs).toBe(800);
  });

  it("increments droppedCount on dropped status", () => {
    const metrics: PipelineMetricsPayload = {
      stage: "segment",
      status: "dropped",
      dropReason: "low_energy",
    };
    const result = reduceDiagnostics(emptyDiagnostics, metrics);
    expect(result.droppedCount).toBe(1);
    expect(result.lastDropReason).toBe("low_energy");
  });

  it("accumulates multiple drops", () => {
    const m1: PipelineMetricsPayload = { stage: "segment", status: "dropped", dropReason: "short" };
    const m2: PipelineMetricsPayload = { stage: "segment", status: "dropped", dropReason: "low_energy" };
    let result = reduceDiagnostics(emptyDiagnostics, m1);
    result = reduceDiagnostics(result, m2);
    expect(result.droppedCount).toBe(2);
  });

  it("updates queue sizes", () => {
    const metrics: PipelineMetricsPayload = {
      stage: "queue",
      status: "stats",
      segmentQueueSize: 5,
      translationQueueSize: 3,
    };
    const result = reduceDiagnostics(emptyDiagnostics, metrics);
    expect(result.segmentQueueSize).toBe(5);
    expect(result.translationQueueSize).toBe(3);
  });

  it("updates audio stats", () => {
    const metrics: PipelineMetricsPayload = {
      stage: "audio",
      status: "stats",
      lowEnergyDrops: 10,
      maxFrameRms: 0.8,
    };
    const result = reduceDiagnostics(emptyDiagnostics, metrics);
    expect(result.lowEnergyDrops).toBe(10);
    expect(result.maxFrameRms).toBe(0.8);
  });

  it("does not mutate original state", () => {
    const original = { ...emptyDiagnostics };
    const metrics: PipelineMetricsPayload = {
      stage: "asr",
      status: "finished",
      asrDurationMs: 500,
    };
    reduceDiagnostics(original, metrics);
    expect(original.latestAsrMs).toBeUndefined();
  });
});
