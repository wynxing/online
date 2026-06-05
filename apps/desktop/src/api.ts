import type {
  Device,
  GlossaryTerm,
  RuntimeConfig,
  SessionRecord,
  SubtitleSegment,
} from "./types";

export const RUNTIME_HTTP = "http://127.0.0.1:8765";
export const RUNTIME_WS = "ws://127.0.0.1:8765/ws/subtitles";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${RUNTIME_HTTP}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export function health(): Promise<{ status: string }> {
  return request("/api/health");
}

export async function getDevices(): Promise<Device[]> {
  const data = await request<{ devices: Device[] }>("/api/devices");
  return data.devices;
}

export function getConfig(): Promise<RuntimeConfig> {
  return request("/api/config");
}

export function saveConfig(config: RuntimeConfig): Promise<RuntimeConfig> {
  return request("/api/config", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export function startSession(body: {
  inputDeviceId: string;
  sourceLang: string;
  targetLang: string;
  displayMode: string;
  asrProvider: string;
  translationProvider: string;
}): Promise<SessionRecord> {
  return request("/api/session/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function stopSession(): Promise<SessionRecord | { status: string }> {
  return request("/api/session/stop", { method: "POST" });
}

export async function getSessions(): Promise<SessionRecord[]> {
  const data = await request<{ sessions: SessionRecord[] }>("/api/sessions");
  return data.sessions;
}

export async function getSessionSegments(sessionId: string): Promise<SubtitleSegment[]> {
  const data = await request<{ segments: SubtitleSegment[] }>(`/api/sessions/${sessionId}/segments`);
  return data.segments;
}

export async function getGlossary(): Promise<GlossaryTerm[]> {
  const data = await request<{ terms: GlossaryTerm[] }>("/api/glossary");
  return data.terms;
}

export function createGlossaryTerm(term: Omit<GlossaryTerm, "id">): Promise<GlossaryTerm> {
  return request("/api/glossary", {
    method: "POST",
    body: JSON.stringify(term),
  });
}

export function updateGlossaryTerm(term: GlossaryTerm): Promise<GlossaryTerm> {
  return request(`/api/glossary/${term.id}`, {
    method: "PUT",
    body: JSON.stringify({
      source: term.source,
      target: term.target,
      domain: term.domain,
      enabled: term.enabled,
    }),
  });
}

export function deleteGlossaryTerm(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/glossary/${id}`, { method: "DELETE" });
}
