import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { health, getDevices, getConfig, saveConfig, getGlossary, getSessions } from "../api";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
  } as Response;
}

describe("health", () => {
  it("returns status from /api/health", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ status: "ok" }));
    const result = await health();
    expect(result.status).toBe("ok");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/health"),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

describe("getDevices", () => {
  it("extracts devices array from response", async () => {
    const devices = [
      { id: "dev_1", name: "Speaker", kind: "system", isDefault: true, available: true },
    ];
    mockFetch.mockResolvedValue(jsonResponse({ devices }));
    const result = await getDevices();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("dev_1");
  });
});

describe("getConfig", () => {
  it("returns runtime config", async () => {
    const config = { baseUrl: "https://api.openai.com/v1", apiKey: "test" };
    mockFetch.mockResolvedValue(jsonResponse(config));
    const result = await getConfig();
    expect(result.baseUrl).toBe("https://api.openai.com/v1");
  });
});

describe("saveConfig", () => {
  it("sends POST with config body", async () => {
    const config = { baseUrl: "https://api.openai.com/v1", apiKey: "new-key" };
    mockFetch.mockResolvedValue(jsonResponse(config));
    await saveConfig(config as never);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/config"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(config),
      })
    );
  });
});

describe("getGlossary", () => {
  it("extracts terms array", async () => {
    const terms = [{ id: "t1", source: "hello", target: "你好", enabled: true }];
    mockFetch.mockResolvedValue(jsonResponse({ terms }));
    const result = await getGlossary();
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("hello");
  });
});

describe("getSessions", () => {
  it("extracts sessions array", async () => {
    const sessions = [{ id: "s1", title: "Test", sourceLang: "en", targetLang: "zh-CN" }];
    mockFetch.mockResolvedValue(jsonResponse({ sessions }));
    const result = await getSessions();
    expect(result).toHaveLength(1);
  });
});

describe("error handling", () => {
  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "not found" }, 404));
    await expect(health()).rejects.toThrow("not found");
  });

  it("falls back to statusText when body has no error", async () => {
    mockFetch.mockResolvedValue(jsonResponse(null, 500));
    await expect(health()).rejects.toThrow("Error");
  });
});
