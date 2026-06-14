import { invoke } from "@tauri-apps/api/core";
import type { Device, GlossaryTerm, RuntimeConfig, SessionRecord, SubtitleSegment } from "./types";

export function health(): Promise<{ status: string }> {
  return invoke("health_check");
}

export function getDevices(): Promise<Device[]> {
  return invoke("list_devices");
}

export function getConfig(): Promise<RuntimeConfig> {
  return invoke("get_config");
}

export function saveConfig(config: RuntimeConfig): Promise<RuntimeConfig> {
  return invoke("save_config", { config });
}

export function startSession(body: {
  inputDeviceId: string;
  sourceLang: string;
  targetLang: string;
  displayMode: string;
  asrProvider: string;
  translationProvider: string;
}): Promise<SessionRecord> {
  return invoke("start_session", { request: body });
}

export function stopSession(): Promise<SessionRecord | { status: string }> {
  return invoke("stop_session");
}

export function getSessions(): Promise<SessionRecord[]> {
  return invoke("list_sessions");
}

export function getSessionSegments(sessionId: string): Promise<SubtitleSegment[]> {
  return invoke("get_segments", { sessionId });
}

export function getGlossary(): Promise<GlossaryTerm[]> {
  return invoke("list_glossary");
}

export function createGlossaryTerm(term: Omit<GlossaryTerm, "id">): Promise<GlossaryTerm> {
  return invoke("create_glossary", { term });
}

export function updateGlossaryTerm(term: GlossaryTerm): Promise<GlossaryTerm> {
  return invoke("update_glossary", { term });
}

export function deleteGlossaryTerm(id: string): Promise<{ deleted: boolean }> {
  return invoke("delete_glossary", { id });
}

export function testTranslation(
  config: Pick<RuntimeConfig, "baseUrl" | "apiKey" | "translationModel">
): Promise<{ ok: boolean; sample?: string; model: string; base_url: string; error?: string }> {
  return invoke("test_translation", {
    request: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      translationModel: config.translationModel,
    },
  });
}

export function testAsr(
  config: Pick<RuntimeConfig, "baseUrl" | "apiKey" | "asrBaseUrl" | "asrApiKey" | "asrModel">
): Promise<{ ok: boolean; model: string; base_url: string; error?: string }> {
  return invoke("test_asr", {
    request: {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      asrBaseUrl: config.asrBaseUrl,
      asrApiKey: config.asrApiKey,
      asrModel: config.asrModel,
    },
  });
}
