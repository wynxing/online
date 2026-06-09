import type { PipelineMetricsPayload, PipelineDiagnostics } from "../types";

export const emptyDiagnostics: PipelineDiagnostics = {
  droppedCount: 0,
  lowEnergyDrops: 0,
};

export function reduceDiagnostics(
  current: PipelineDiagnostics,
  metrics: PipelineMetricsPayload,
): PipelineDiagnostics {
  const next: PipelineDiagnostics = { ...current };
  if (metrics.segmentId) {
    next.latestSegmentId = metrics.segmentId;
  }
  if (metrics.stage === "asr" && metrics.status === "finished" && typeof metrics.asrDurationMs === "number") {
    next.latestAsrMs = metrics.asrDurationMs;
  }
  if (
    metrics.stage === "translation" &&
    metrics.status === "finished" &&
    typeof metrics.translationDurationMs === "number"
  ) {
    next.latestTranslationMs = metrics.translationDurationMs;
    if (typeof metrics.endToEndMs === "number") {
      next.latestEndToEndMs = metrics.endToEndMs;
    }
  }
  if (typeof metrics.segmentQueueSize === "number") {
    next.segmentQueueSize = metrics.segmentQueueSize;
  }
  if (typeof metrics.translationQueueSize === "number") {
    next.translationQueueSize = metrics.translationQueueSize;
  }
  if (metrics.status === "dropped") {
    next.droppedCount += 1;
    next.lastDropReason = metrics.dropReason;
  }
  if (metrics.stage === "audio" && metrics.status === "stats") {
    next.lowEnergyDrops = metrics.lowEnergyDrops ?? next.lowEnergyDrops;
    next.maxFrameRms = metrics.maxFrameRms ?? next.maxFrameRms;
  }
  return next;
}
