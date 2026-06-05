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

export interface RuntimeEvent<T = unknown> {
  type: string;
  payload: T;
}
