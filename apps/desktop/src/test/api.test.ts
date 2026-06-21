import { beforeEach, describe, expect, it } from "vitest";
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
import { invokeMock } from "./tauriMock";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("api adapter", () => {
  it("calls health_check", async () => {
    invokeMock.mockResolvedValue({ status: "ok" });
    await expect(health()).resolves.toEqual({ status: "ok" });
    expect(invokeMock).toHaveBeenCalledWith("health_check");
  });

  it("loads devices directly from list_devices", async () => {
    const devices = [
      { id: "input_0", name: "Microphone", kind: "microphone", isDefault: true, available: true },
    ];
    invokeMock.mockResolvedValue(devices);
    await expect(getDevices()).resolves.toEqual(devices);
    expect(invokeMock).toHaveBeenCalledWith("list_devices");
  });

  it("loads and saves config", async () => {
    const config = { baseUrl: "https://api.openai.com/v1", apiKey: "test" };
    invokeMock.mockResolvedValue(config);
    await expect(getConfig()).resolves.toEqual(config);
    expect(invokeMock).toHaveBeenCalledWith("get_config");

    await saveConfig(config as never);
    expect(invokeMock).toHaveBeenCalledWith("save_config", { config });
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
    invokeMock.mockResolvedValue({ id: "s1" });
    await startSession(body);
    expect(invokeMock).toHaveBeenCalledWith("start_session", { request: body });

    await stopSession();
    expect(invokeMock).toHaveBeenCalledWith("stop_session");
  });

  it("maps history and glossary commands", async () => {
    invokeMock.mockResolvedValue([]);
    await getSessions();
    expect(invokeMock).toHaveBeenCalledWith("list_sessions");

    await getSessionSegments("s1");
    expect(invokeMock).toHaveBeenCalledWith("get_segments", { sessionId: "s1" });

    await getGlossary();
    expect(invokeMock).toHaveBeenCalledWith("list_glossary");

    const term = { source: "latency", target: "delay", enabled: true };
    await createGlossaryTerm(term);
    expect(invokeMock).toHaveBeenCalledWith("create_glossary", { term });

    const saved = { id: "t1", ...term };
    await updateGlossaryTerm(saved);
    expect(invokeMock).toHaveBeenCalledWith("update_glossary", { term: saved });

    await deleteGlossaryTerm("t1");
    expect(invokeMock).toHaveBeenCalledWith("delete_glossary", { id: "t1" });
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
    invokeMock.mockResolvedValue({ ok: true });
    await testAsr(config);
    expect(invokeMock).toHaveBeenCalledWith("test_asr", {
      request: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        asrBaseUrl: config.asrBaseUrl,
        asrApiKey: config.asrApiKey,
        asrModel: config.asrModel,
      },
    });

    await testTranslation(config);
    expect(invokeMock).toHaveBeenCalledWith("test_translation", {
      request: {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        translationModel: config.translationModel,
      },
    });
  });

  it("propagates invoke errors", async () => {
    invokeMock.mockRejectedValue(new Error("not found"));
    await expect(health()).rejects.toThrow("not found");
  });
});
