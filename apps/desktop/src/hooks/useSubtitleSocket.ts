import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { mergeSegment } from "../subtitleState";
import { reduceDiagnostics, emptyDiagnostics } from "../utils/diagnostics";
import type {
  ErrorLogEntry,
  PipelineDiagnostics,
  PipelineMetricsPayload,
  RuntimeErrorPayload,
  RuntimeStatus,
  SubtitleSegment,
} from "../types";

export function useSubtitleSocket() {
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [sessionStatus, setSessionStatus] = useState("idle");
  const [socketStatus, setSocketStatus] = useState<RuntimeStatus>("checking");
  const [correctedIds, setCorrectedIds] = useState<Set<string>>(new Set());
  const [errorLog, setErrorLog] = useState<ErrorLogEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<PipelineDiagnostics>(emptyDiagnostics);

  useEffect(() => {
    let closed = false;
    const unlisten: UnlistenFn[] = [];

    async function subscribe() {
      unlisten.push(
        await listen<{ status?: string }>("session:status", (event) => {
          setSessionStatus(event.payload.status ?? "connected");
        })
      );
      unlisten.push(
        await listen<SubtitleSegment>("subtitle:segment-created", (event) => {
          setSegments((current) => mergeSegment(current, event.payload));
        })
      );
      unlisten.push(
        await listen<SubtitleSegment>("subtitle:segment-updated", (event) => {
          setSegments((current) => mergeSegment(current, event.payload));
        })
      );
      unlisten.push(
        await listen<SubtitleSegment>("subtitle:segment-corrected", (event) => {
          const segment = event.payload;
          setSegments((current) => mergeSegment(current, segment));
          setCorrectedIds((current) => new Set(current).add(segment.id));
          window.setTimeout(() => {
            setCorrectedIds((current) => {
              const next = new Set(current);
              next.delete(segment.id);
              return next;
            });
          }, 2200);
        })
      );
      unlisten.push(
        await listen<PipelineMetricsPayload>("pipeline:metrics", (event) => {
          setDiagnostics((current) => reduceDiagnostics(current, event.payload));
        })
      );
      unlisten.push(
        await listen<RuntimeErrorPayload>("runtime:error", (event) => {
          const err = event.payload;
          setErrorLog((prev) => [
            { code: err.code, message: err.message, time: new Date().toLocaleTimeString() },
            ...prev,
          ]);
        })
      );
      if (!closed) setSocketStatus("connected");
    }

    void subscribe().catch(() => {
      if (!closed) setSocketStatus("disconnected");
    });

    return () => {
      closed = true;
      for (const off of unlisten) off();
      setSocketStatus("disconnected");
    };
  }, []);

  return {
    segments,
    setSegments,
    sessionStatus,
    socketStatus,
    correctedIds,
    errorLog,
    setErrorLog,
    diagnostics,
    setDiagnostics,
    reconnectAttempt: 0,
  };
}
