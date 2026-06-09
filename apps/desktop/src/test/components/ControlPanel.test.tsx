import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ControlPanel } from "../../components/ControlPanel";
import type { Device, RuntimeConfig } from "../../types";

const defaultConfig: RuntimeConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  translationModel: "gpt-4o-mini",
  asrProvider: "mock",
  translationProvider: "openai-compatible",
  defaultInputDeviceId: "dev_1",
  displayMode: "bilingual",
  fontSize: 24,
  glossaryEnabled: true,
  asrBaseUrl: "",
  asrApiKey: "",
  asrModel: "whisper-1",
  asrLanguage: "en",
  asrFormat: "whisper",
  asrConcurrency: 2,
  translationConcurrency: 3,
  segmentMinDuration: 1.2,
  segmentMaxDuration: 3.0,
  segmentSilenceDuration: 0.35,
  diagnosticsEnabled: true,
};

const mockDevices: Device[] = [
  { id: "dev_1", name: "System Loopback", kind: "system", isDefault: true, available: true },
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
  return { ...render(<ControlPanel {...defaultProps} />), props: defaultProps };
}

describe("ControlPanel", () => {
  it("renders audio source heading", () => {
    renderControlPanel();
    expect(screen.getByText("音频来源")).toBeInTheDocument();
  });

  it("renders device options", () => {
    renderControlPanel();
    expect(screen.getByText("System Loopback")).toBeInTheDocument();
    expect(screen.getByText("Microphone")).toBeInTheDocument();
  });

  it("calls onStart when start button is clicked", () => {
    const { props } = renderControlPanel();
    fireEvent.click(screen.getByText("开始同传"));
    expect(props.onStart).toHaveBeenCalledTimes(1);
  });

  it("calls onStop when stop button is clicked", () => {
    const { props } = renderControlPanel({ isRunning: true });
    fireEvent.click(screen.getByText("停止"));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("disables start button when running", () => {
    renderControlPanel({ isRunning: true });
    expect(screen.getByText("开始同传")).toBeDisabled();
  });

  it("disables stop button when not running", () => {
    renderControlPanel({ isRunning: false });
    expect(screen.getByText("停止")).toBeDisabled();
  });

  it("calls onClear when clear button is clicked", () => {
    const { props } = renderControlPanel();
    fireEvent.click(screen.getByText("清空当前字幕"));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it("shows loopback hint for system device", () => {
    renderControlPanel();
    expect(screen.getByText(/已选择系统音频 loopback/)).toBeInTheDocument();
  });

  it("shows mic hint for microphone device", () => {
    renderControlPanel({
      config: { ...defaultConfig, defaultInputDeviceId: "dev_2" },
    });
    expect(screen.getByText(/当前选择的是麦克风/)).toBeInTheDocument();
  });

  it("renders display mode buttons", () => {
    renderControlPanel();
    expect(screen.getByText("原文")).toBeInTheDocument();
    expect(screen.getByText("译文")).toBeInTheDocument();
    expect(screen.getByText("双语")).toBeInTheDocument();
  });

  it("calls setConfig when display mode is changed", () => {
    const { props } = renderControlPanel();
    fireEvent.click(screen.getByText("原文"));
    expect(props.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ displayMode: "source" })
    );
  });
});
