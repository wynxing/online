import { useEffect, useRef, useState } from "react";
import { RUNTIME_WS } from "../api";
import { mergeSegment } from "../subtitleState";
import { reduceDiagnostics, emptyDiagnostics } from "../utils/diagnostics";
import type {
  ErrorLogEntry,
  PipelineDiagnostics,
  PipelineMetricsPayload,
  RuntimeErrorPayload,
  RuntimeEvent,
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
  const reconnectTimer = useRef<number>();

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | undefined;

    const connect = () => {
      socket = new WebSocket(RUNTIME_WS);
      socket.onopen = () => setSocketStatus("connected");
      socket.onclose = () => {
        setSocketStatus("disconnected");
        if (!closed) {
          reconnectTimer.current = window.setTimeout(connect, 1200);
        }
      };
      socket.onerror = () => setSocketStatus("disconnected");
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data) as RuntimeEvent;
        if (event.type === "session.status") {
          const payload = event.payload as { status?: string };
          setSessionStatus(payload.status ?? "connected");
          return;
        }
        if (
          event.type === "segment.created" ||
          event.type === "segment.updated" ||
          event.type === "segment.corrected"
        ) {
          const segment = event.payload as SubtitleSegment;
          setSegments((current) => mergeSegment(current, segment));
          if (event.type === "segment.corrected") {
            setCorrectedIds((current) => new Set(current).add(segment.id));
            window.setTimeout(() => {
              setCorrectedIds((current) => {
                const next = new Set(current);
                next.delete(segment.id);
                return next;
              });
            }, 2200);
          }
          return;
        }
        if (event.type === "pipeline.metrics") {
          const metrics = event.payload as PipelineMetricsPayload;
          setDiagnostics((current) => reduceDiagnostics(current, metrics));
          return;
        }
        if (event.type === "runtime.error") {
          const err = event.payload as RuntimeErrorPayload;
          setErrorLog((prev) => [
            { code: err.code, message: err.message, time: new Date().toLocaleTimeString() },
            ...prev,
          ]);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer.current);
      socket?.close();
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
  };
}
