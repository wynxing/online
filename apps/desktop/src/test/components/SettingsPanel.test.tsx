import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../../components/SettingsPanel";
import type { RuntimeConfig } from "../../types";
import { withLang } from "../helpers";

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

function renderPanel(overrides: Partial<React.ComponentProps<typeof SettingsPanel>> = {}) {
  const props: React.ComponentProps<typeof SettingsPanel> = {
    config,
    setConfig: vi.fn(),
    testing: null,
    testResult: null,
    onTestAsr: vi.fn(),
    onTestTranslation: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
  render(withLang(<SettingsPanel {...props} />, "en"));
  return props;
}

describe("SettingsPanel", () => {
  it("updates connection, language, performance, audio, and display settings", () => {
    const setConfig = vi.fn();
    renderPanel({ setConfig });

    fireEvent.change(screen.getByLabelText("API format"), {
      target: { value: "chat-completions" },
    });
    fireEvent.change(screen.getByLabelText("ASR Base URL"), {
      target: { value: "https://new-asr.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("ASR API Key"), { target: { value: "new-asr" } });
    fireEvent.change(screen.getByLabelText("ASR model"), { target: { value: "whisper-new" } });
    fireEvent.change(screen.getByLabelText(/Recognition language/), { target: { value: "auto" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://new-api.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "new-key" } });
    fireEvent.change(screen.getByLabelText("Translation model"), { target: { value: "gpt-new" } });
    fireEvent.change(screen.getByLabelText("Source language"), { target: { value: "ja" } });
    fireEvent.change(screen.getByLabelText("Target language"), { target: { value: "en" } });

    fireEvent.change(screen.getByLabelText("Min segment seconds"), { target: { value: "1.5" } });
    fireEvent.change(screen.getByLabelText("Max segment seconds"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Silence split seconds"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByLabelText("Enable VAD voice endpoint detection"));
    fireEvent.change(screen.getByLabelText("ASR concurrency"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Translation concurrency"), { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("Noise reduction"));
    fireEvent.click(screen.getByLabelText("Auto volume normalization"));
    const resampleSelect = screen
      .getAllByRole("combobox")
      .find((element) => (element as HTMLSelectElement).value === "fast");
    expect(resampleSelect).toBeDefined();
    fireEvent.change(resampleSelect!, { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Subtitle font size"), { target: { value: "32" } });
    fireEvent.click(screen.getByLabelText("Use glossary during translation"));
    fireEvent.click(screen.getByLabelText("Show realtime diagnostics"));

    expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({ segmentMinDuration: 1.5 }));
    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLang: "ja", asrLanguage: "ja" })
    );
    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ audioResampleQuality: "high" })
    );
    expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 32 }));
    expect(setConfig).toHaveBeenCalledTimes(22);
  });

  it("runs connection checks and save actions", async () => {
    const user = userEvent.setup();
    const props = renderPanel();

    await user.click(screen.getByRole("button", { name: "Test ASR connection" }));
    await user.click(screen.getByRole("button", { name: "Test translation connection" }));
    await user.click(screen.getByRole("button", { name: "Save configuration" }));

    expect(props.onTestAsr).toHaveBeenCalledOnce();
    expect(props.onTestTranslation).toHaveBeenCalledOnce();
    expect(props.onSave).toHaveBeenCalledOnce();
  });

  it("shows testing and result states", () => {
    const { rerender } = render(
      withLang(
        <SettingsPanel
          config={{ ...config, asrFormat: "chat-completions" }}
          setConfig={vi.fn()}
          testing="asr"
          testResult={{ kind: "asr", ok: false, message: "ASR unavailable" }}
          onTestAsr={vi.fn()}
          onTestTranslation={vi.fn()}
          onSave={vi.fn()}
        />,
        "en"
      )
    );

    expect(screen.getByText("Testing...")).toBeDisabled();
    expect(screen.getByText("Failed: ASR unavailable")).toHaveClass("fail");
    expect(screen.getByText(/Sends base64 audio/)).toBeInTheDocument();

    rerender(
      withLang(
        <SettingsPanel
          config={config}
          setConfig={vi.fn()}
          testing="translation"
          testResult={{ kind: "translation", ok: true, message: "Connected" }}
          onTestAsr={vi.fn()}
          onTestTranslation={vi.fn()}
          onSave={vi.fn()}
        />,
        "en"
      )
    );
    expect(screen.getByText("OK: Connected")).toHaveClass("ok");
  });
});
