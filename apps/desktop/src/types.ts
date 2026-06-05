export type DisplayMode = "source" | "translated" | "bilingual";
export type SubtitleStatus = "interim" | "final" | "corrected";

export interface Device {
  id: string;
  name: string;
  kind: "system" | "microphone" | "mock";
  isDefault: boolean;
  available: boolean;
  description?: string;
}

export interface RuntimeConfig {
  baseUrl: string;
  apiKey: string;
  translationModel: string;
  asrProvider: string;
  translationProvider: string;
  defaultInputDeviceId: string;
  displayMode: DisplayMode;
  fontSize: number;
  glossaryEnabled: boolean;
  asrBaseUrl: string;
  asrApiKey: string;
  asrModel: string;
  asrLanguage: string;
  asrFormat: string;
  asrConcurrency: number;
  translationConcurrency: number;
  segmentMinDuration: number;
  segmentMaxDuration: number;
  segmentSilenceDuration: number;
  diagnosticsEnabled: boolean;
}

export interface SubtitleSegment {
  id: string;
  sessionId: string;
  sourceText: string;
  translatedText: string;
  status: SubtitleStatus;
  version: number;
  startTime: number;
  endTime?: number;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  startedAt: string;
  endedAt?: string;
}

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  domain?: string;
  enabled: boolean;
}

export interface RuntimeErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface PipelineMetricsPayload {
  sessionId?: string;
  segmentId?: string;
  stage: "audio" | "segment" | "asr" | "translation" | "queue";
  status: "stats" | "queued" | "started" | "finished" | "dropped" | "failed";
  updatedAt?: string;
  dropReason?: string;
  droppedCount?: number;
  workerId?: number;
  audioStart?: number;
  audioEnd?: number;
  audioDurationMs?: number;
  asrDurationMs?: number | null;
  translationDurationMs?: number | null;
  endToEndMs?: number | null;
  queueLagMs?: number | null;
  segmentQueueSize?: number;
  translationQueueSize?: number;
  frames?: number;
  segments?: number;
  lowEnergyDrops?: number;
  lastFrameRms?: number;
  maxFrameRms?: number;
  lastSegmentRms?: number;
  maxSegmentRms?: number;
  error?: string;
}

export interface RuntimeEvent<T = unknown> {
  type: string;
  payload: T;
}
