import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { Device, RuntimeConfig, SessionRecord, SubtitleSegment } from "../types";
import {
  emitTauriEvent,
  getByLabelMock,
  setFocusMock,
  webviewWindowConstructorMock,
} from "./tauriMock";

const apiMocks = vi.hoisted(() => ({
  createGlossaryTerm: vi.fn(),
  deleteGlossaryTerm: vi.fn(),
  getConfig: vi.fn(),
  getDevices: vi.fn(),
  getGlossary: vi.fn(),
  getSessionSegments: vi.fn(),
  getSessions: vi.fn(),
  saveConfig: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
  testAsr: vi.fn(),
  testTranslation: vi.fn(),
  updateGlossaryTerm: vi.fn(),
}));

vi.mock("../api", () => apiMocks);

vi.mock("../hooks/useUpdateChecker", () => ({
  useUpdateChecker: () => ({
    status: "idle",
    updateInfo: null,
    progress: null,
    error: null,
    downloadAndInstall: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn() }),
}));

const config: RuntimeConfig = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "translation-key",
  translationModel: "gpt-4o-mini",
  asrProvider: "openai-compatible",
  translationProvider: "openai-compatible",
  defaultInputDeviceId: "microphone-1",
  displayMode: "bilingual",
  fontSize: 24,
  glossaryEnabled: true,
  asrBaseUrl: "https://asr.example.com/v1",
  asrApiKey: "asr-key",
  asrModel: "whisper-1",
  asrLanguage: "en",
  sourceLang: "en",
  targetLang: "zh-CN",
  asrFormat: "whisper",
  asrConcurrency: 2,
  translationConcurrency: 3,
  segmentMinDuration: 1.2,
  segmentMaxDuration: 3,
  segmentSilenceDuration: 0.35,
  vadEnabled: true,
  diagnosticsEnabled: true,
  audioDenoiseEnabled: true,
  audioPeakNormalizeEnabled: true,
  audioResampleQuality: "fast",
};

const devices: Device[] = [
  {
    id: "microphone-1",
    name: "Microphone",
    kind: "microphone",
    isDefault: true,
    available: true,
  },
];

const session: SessionRecord = {
  id: "session-1",
  title: "English to Chinese",
  sourceLang: "en",
  targetLang: "zh-CN",
  startedAt: "2026-06-21T00:00:00Z",
};

const historySegment: SubtitleSegment = {
  id: "segment-1",
  sessionId: session.id,
  sourceText: "meeting started",
  translatedText: "会议开始了",
  status: "final",
  version: 1,
  startTime: 0,
  endTime: 1,
  updatedAt: "2026-06-21T00:00:01Z",
};

function setTauriAvailable(available: boolean) {
  const tauriWindow = window as Window & { __TAURI_INTERNALS__?: object };
  if (available) tauriWindow.__TAURI_INTERNALS__ = {};
  else delete tauriWindow.__TAURI_INTERNALS__;
}

async function renderReadyApp() {
  const view = render(<App />);
  await screen.findByText("Runtime ready");
  return view;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("lang", "en");
  window.history.replaceState({}, "", "/");
  setTauriAvailable(false);

  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.getConfig.mockResolvedValue(config);
  apiMocks.getDevices.mockResolvedValue(devices);
  apiMocks.getGlossary.mockResolvedValue([]);
  apiMocks.getSessions.mockResolvedValue([]);
  apiMocks.getSessionSegments.mockResolvedValue([]);
  apiMocks.saveConfig.mockResolvedValue(config);
  apiMocks.startSession.mockResolvedValue(session);
  apiMocks.stopSession.mockResolvedValue({ ...session, endedAt: "2026-06-21T00:01:00Z" });
});

describe("App desktop flows", () => {
  it("bootstraps runtime data successfully", async () => {
    await renderReadyApp();

    expect(apiMocks.getConfig).toHaveBeenCalledOnce();
    expect(apiMocks.getDevices).toHaveBeenCalledOnce();
    expect(apiMocks.getGlossary).toHaveBeenCalledOnce();
    expect(apiMocks.getSessions).toHaveBeenCalledOnce();
    expect(screen.getByRole("combobox", { name: "Capture source" })).toHaveValue("microphone-1");
  });

  it("shows initialization failures", async () => {
    apiMocks.getConfig.mockRejectedValue(new Error("database unavailable"));

    render(<App />);

    expect(
      await screen.findByText("Runtime initialization failed: database unavailable")
    ).toBeInTheDocument();
  });

  it("saves the loaded configuration", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Save configuration" }));

    await waitFor(() => expect(apiMocks.saveConfig).toHaveBeenCalledWith(config));
    expect(screen.getByText("Configuration saved")).toBeInTheDocument();
  });

  it("starts and stops a session", async () => {
    const user = userEvent.setup();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(apiMocks.startSession).toHaveBeenCalledWith({
        inputDeviceId: "microphone-1",
        sourceLang: "en",
        targetLang: "zh-CN",
        displayMode: "bilingual",
        asrProvider: "openai-compatible",
        translationProvider: "openai-compatible",
      })
    );
    expect(screen.getByText("Session started")).toBeInTheDocument();

    act(() => emitTauriEvent("session:status", { status: "running" }));
    await user.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(apiMocks.stopSession).toHaveBeenCalledOnce());
    expect(apiMocks.getSessions).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Session stopped and saved")).toBeInTheDocument();
  });

  it("focuses an existing floating subtitle window", async () => {
    setTauriAvailable(true);
    getByLabelMock.mockResolvedValue({ setFocus: setFocusMock });
    const user = userEvent.setup();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: "Floating subtitles" }));

    await waitFor(() => expect(setFocusMock).toHaveBeenCalledOnce());
    expect(webviewWindowConstructorMock).not.toHaveBeenCalled();
  });

  it("creates the floating subtitle window when one does not exist", async () => {
    setTauriAvailable(true);
    getByLabelMock.mockResolvedValue(null);
    await renderReadyApp();

    fireEvent.click(screen.getByRole("button", { name: "Floating subtitles" }));

    await waitFor(() =>
      expect(webviewWindowConstructorMock).toHaveBeenCalledWith(
        "floating-subtitles",
        expect.objectContaining({
          url: "/?view=floating",
          alwaysOnTop: true,
          transparent: true,
        })
      )
    );
  });

  it("loads a selected history session", async () => {
    apiMocks.getSessions.mockResolvedValue([session]);
    apiMocks.getSessionSegments.mockResolvedValue([historySegment]);
    const user = userEvent.setup();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: "History" }));
    await user.click(screen.getByRole("button", { name: /English to Chinese/ }));

    await waitFor(() => expect(apiMocks.getSessionSegments).toHaveBeenCalledWith(session.id));
    expect(screen.getByText("meeting started")).toBeInTheDocument();
    expect(screen.getByText("会议开始了")).toBeInTheDocument();
  });

  it("adds, toggles, and removes glossary terms", async () => {
    const existing = {
      id: "term-1",
      source: "latency",
      target: "延迟",
      domain: "technical",
      enabled: true,
    };
    const created = {
      id: "term-2",
      source: "throughput",
      target: "吞吐量",
      domain: "technical",
      enabled: true,
    };
    apiMocks.getGlossary.mockResolvedValue([existing]);
    apiMocks.createGlossaryTerm.mockResolvedValue(created);
    apiMocks.updateGlossaryTerm.mockResolvedValue({ ...existing, enabled: false });
    apiMocks.deleteGlossaryTerm.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    const { container } = await renderReadyApp();

    await user.click(screen.getByRole("button", { name: "Glossary" }));
    await user.type(screen.getByLabelText("Source term"), "throughput");
    await user.type(screen.getByLabelText("Target translation"), "吞吐量");
    await user.type(screen.getByLabelText("Domain"), "technical");
    await user.click(screen.getByRole("button", { name: "Add term" }));

    await waitFor(() =>
      expect(apiMocks.createGlossaryTerm).toHaveBeenCalledWith({
        source: "throughput",
        target: "吞吐量",
        domain: "technical",
        enabled: true,
      })
    );
    expect(screen.getByText("throughput")).toBeInTheDocument();

    const toggle = container.querySelector<HTMLButtonElement>(".term-row .switch");
    expect(toggle).not.toBeNull();
    await user.click(toggle!);
    await waitFor(() =>
      expect(apiMocks.updateGlossaryTerm).toHaveBeenCalledWith({ ...existing, enabled: false })
    );

    await user.click(screen.getAllByTitle("Delete term")[0]);
    await waitFor(() => expect(apiMocks.deleteGlossaryTerm).toHaveBeenCalledWith(existing.id));
  });

  it("reports ASR success and translation connection failure", async () => {
    apiMocks.testAsr.mockResolvedValue({ base_url: "https://asr.example.com/v1" });
    apiMocks.testTranslation.mockRejectedValue(new Error("translation unavailable"));
    const user = userEvent.setup();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Test ASR connection" }));
    expect(
      await screen.findByText(/Connected: https:\/\/asr\.example\.com\/v1/)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Test translation connection" }));
    expect(await screen.findByText(/translation unavailable/)).toBeInTheDocument();
  });

  it("renders and updates floating subtitles", async () => {
    window.history.replaceState({}, "", "/?view=floating");
    window.localStorage.setItem("fontSize", "30");
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Waiting for session to start...")).toBeInTheDocument()
    );
    act(() => emitTauriEvent("subtitle:segment-created", historySegment));
    expect(screen.getByText("meeting started")).toHaveStyle({ fontSize: "22.5px" });

    await user.click(screen.getByRole("button", { name: "Source" }));
    expect(window.localStorage.getItem("floatingDisplayMode")).toBe("source");

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "fontSize", newValue: "40" }));
    });
    expect(screen.getByText("meeting started")).toHaveStyle({ fontSize: "30px" });
  });
});
