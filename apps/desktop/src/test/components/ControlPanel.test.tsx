import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ControlPanel } from "../../components/ControlPanel";
import { withLang } from "../helpers";
import type { Device, RuntimeConfig } from "../../types";

const defaultConfig: RuntimeConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  translationModel: "gpt-4o-mini",
  asrProvider: "openai-compatible",
  translationProvider: "openai-compatible",
  defaultInputDeviceId: "dev_1",
  displayMode: "bilingual",
  fontSize: 24,
  glossaryEnabled: true,
  asrBaseUrl: "",
  asrApiKey: "",
  asrModel: "whisper-1",
  asrLanguage: "en",
  sourceLang: "en",
  targetLang: "zh-CN",
  asrFormat: "whisper",
  asrConcurrency: 2,
  translationConcurrency: 3,
  segmentMinDuration: 1.2,
  segmentMaxDuration: 3.0,
  segmentSilenceDuration: 0.35,
  diagnosticsEnabled: true,
};

const mockDevices: Device[] = [
  {
    id: "dev_1",
    name: "Speakers (Realtek(R) Audio)",
    displayName: "System audio - Speakers (Realtek(R) Audio) (Default)",
    kind: "system",
    isDefault: true,
    available: true,
    description: "Windows WASAPI loopback for system audio capture.",
  },
  { id: "dev_2", name: "Microphone", kind: "microphone", isDefault: false, available: true },
];

function renderControlPanel(overrides = {}) {
  const defaultProps = {
    config: defaultConfig,
    setConfig: vi.fn(),
    devices: mockDevices,
    isRunning: false,
    onStart: vi.fn(),
    onStop: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  return { ...render(withLang(<ControlPanel {...defaultProps} />)), props: defaultProps };
}

describe("ControlPanel", () => {
  it("renders audio source heading", () => {
    renderControlPanel();
    expect(screen.getByText("Audio source")).toBeInTheDocument();
  });

  it("renders device options", () => {
    renderControlPanel();
    expect(
      screen.getByText("System audio - Speakers (Realtek(R) Audio) (Default)")
    ).toBeInTheDocument();
    expect(screen.getByText("Microphone")).toBeInTheDocument();
  });

  it("uses displayName for device options and falls back to name", () => {
    renderControlPanel();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("System audio - Speakers (Realtek(R) Audio) (Default)");
    expect(options[1]).toHaveTextContent("Microphone");
  });

  it("calls onStart when start button is clicked", () => {
    const { props } = renderControlPanel();
    fireEvent.click(screen.getByText("Start"));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it("calls onStop when stop button is clicked", () => {
    const { props } = renderControlPanel({ isRunning: true });
    fireEvent.click(screen.getByText("Stop"));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("disables start button when running", () => {
    renderControlPanel({ isRunning: true });
    expect(screen.getByText("Start")).toBeDisabled();
  });

  it("disables stop button when not running", () => {
    renderControlPanel({ isRunning: false });
    expect(screen.getByText("Stop")).toBeDisabled();
  });

  it("calls onClear when clear button is clicked", () => {
    const { props } = renderControlPanel();
    fireEvent.click(screen.getByText("Clear subtitles"));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it("shows the selected device note", () => {
    renderControlPanel();
    expect(screen.getByText(/Windows WASAPI loopback/)).toBeInTheDocument();
    expect(screen.getByText(/Default device/)).toBeInTheDocument();
    expect(screen.getByText(/Device id: dev_1/)).toBeInTheDocument();
  });

  it("renders display mode buttons", () => {
    renderControlPanel();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Translation")).toBeInTheDocument();
    expect(screen.getByText("Bilingual")).toBeInTheDocument();
  });

  it("calls setConfig when display mode is changed", () => {
    const { props } = renderControlPanel();
    fireEvent.click(screen.getByText("Source"));
    expect(props.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ displayMode: "source" })
    );
  });
});
