import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  getConfig,
  getDevices,
  getGlossary,
  getSessionSegments,
  getSessions,
  health,
  saveConfig,
  startSession,
  stopSession,
  testAsr,
  testTranslation,
  updateGlossaryTerm,
} from "../api";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("api adapter", () => {
  it("calls health_check", async () => {
    mocks.invoke.mockResolvedValue({ status: "ok" });
    await expect(health()).resolves.toEqual({ status: "ok" });
    expect(mocks.invoke).toHaveBeenCalledWith("health_check");
  });

  it("loads devices directly from list_devices", async () => {
    const devices = [
      { id: "input_0", name: "Microphone", kind: "microphone", isDefault: true, available: true },
    ];
    mocks.invoke.mockResolvedValue(devices);
    await expect(getDevices()).resolves.toEqual(devices);
    expect(mocks.invoke).toHaveBeenCalledWith("list_devices");
  });

  it("loads and saves config", async () => {
    const config = { baseUrl: "https://api.openai.com/v1", apiKey: "test" };
    mocks.invoke.mockResolvedValue(config);
    await expect(getConfig()).resolves.toEqual(config);
    expect(mocks.invoke).toHaveBeenCalledWith("get_config");

    await saveConfig(config as never);
    expect(mocks.invoke).toHaveBeenCalledWith("save_config", { config });
  });

  it("maps session commands", async () => {
    const body = {
      inputDeviceId: "input_0",
      sourceLang: "en",
      targetLang: "zh-CN",
      displayMode: "bilingual",
      asrProvider: "openai-compatible",
      translationProvider: "openai-compatible",
    };
    mocks.invoke.mockResolvedValue({ id: "s1" });
    await startSession(body);
    expect(mocks.invoke).toHaveBeenCalledWith("start_session", { request: body });

    await stopSession();
    expect(mocks.invoke).toHaveBeenCalledWith("stop_session");
  });

  it("maps history and glossary commands", async () => {
    mocks.invoke.mockResolvedValue([]);
    await getSessions();
    expect(mocks.invoke).toHaveBeenCalledWith("list_sessions");

    await getSessionSegments("s1");
    expect(mocks.invoke).toHaveBeenCalledWith("get_segments", { sessionId: "s1" });

    await getGlossary();
    expect(mocks.invoke).toHaveBeenCalledWith("list_glossary");

    const term = { source: "latency", target: "delay", enabled: true };
    await createGlossaryTerm(term);
    expect(mocks.invoke).toHaveBeenCalledWith("create_glossary", { term });

    const saved = { id: "t1", ...term };
    await updateGlossaryTerm(saved);
    expect(mocks.invoke).toHaveBeenCalledWith("update_glossary", { term: saved });

    await deleteGlossaryTerm("t1");
    expect(mocks.invoke).toHaveBeenCalledWith("delete_glossary", { id: "t1" });
  });

  it("maps connectivity tests", async () => {
    const config = {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "key",
      asrBaseUrl: "",
      asrApiKey: "",
      asrModel: "whisper-1",
      translationModel: "gpt-4o-mini",
    };
    mocks.invoke.mockResolvedValue({ ok: true });
    await testAsr(config);
    expect(mocks.invoke).toHaveBeenCalledWith("test_asr", {
      request: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        asrBaseUrl: config.asrBaseUrl,
        asrApiKey: config.asrApiKey,
        asrModel: config.asrModel,
      },
    });

    await testTranslation(config);
    expect(mocks.invoke).toHaveBeenCalledWith("test_translation", {
      request: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        translationModel: config.translationModel,
      },
    });
  });

  it("propagates invoke errors", async () => {
    mocks.invoke.mockRejectedValue(new Error("not found"));
    await expect(health()).rejects.toThrow("not found");
  });
});
