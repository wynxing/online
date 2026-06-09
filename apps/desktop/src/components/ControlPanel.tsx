import { MonitorSpeaker, Mic, Play, Square, Trash2 } from "lucide-react";
import type { Device, DisplayMode, RuntimeConfig } from "../types";

interface ControlPanelProps {
  config: RuntimeConfig;
  setConfig: (config: RuntimeConfig) => void;
  devices: Device[];
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}

export function ControlPanel({ config, setConfig, devices, isRunning, onStart, onStop, onClear }: ControlPanelProps) {
  const sourceDevice = devices.find((device) => device.id === config.defaultInputDeviceId);

  return (
    <div className="control-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Input</span>
          <h2>音频来源</h2>
        </div>
        {sourceDevice?.kind === "system" || sourceDevice?.kind === "mock" ? <MonitorSpeaker /> : <Mic />}
      </div>
      <label className="field">
        <span>优先采集源</span>
        <select
          value={config.defaultInputDeviceId}
          onChange={(event) => setConfig({ ...config, defaultInputDeviceId: event.target.value })}
        >
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      </label>
      <div className="device-note">
        {sourceDevice?.kind === "system"
          ? "已选择系统音频 loopback，可采集播放声音。"
          : sourceDevice?.kind === "microphone"
            ? "当前选择的是麦克风。要采集系统播放声音，请选择带 [Loopback] 的设备。"
            : sourceDevice?.description ?? "请选择音频输入设备。"}
      </div>
      <div className="segmented">
        {(["source", "translated", "bilingual"] as DisplayMode[]).map((mode) => (
          <button
            key={mode}
            className={config.displayMode === mode ? "active" : ""}
            onClick={() => setConfig({ ...config, displayMode: mode })}
          >
            {modeLabel(mode)}
          </button>
        ))}
      </div>
      <label className="field">
        <span>识别模式</span>
        <select
          value={config.asrProvider}
          onChange={(event) => setConfig({ ...config, asrProvider: event.target.value })}
        >
          <option value="mock">Mock 演示模式</option>
          <option value="openai-compatible">真实识别（兼容 API）</option>
        </select>
      </label>
      <div className="run-controls">
        <button className="primary-button" disabled={isRunning} onClick={onStart}>
          <Play />
          开始同传
        </button>
        <button className="danger-button" disabled={!isRunning} onClick={onStop}>
          <Square />
          停止
        </button>
      </div>
      <button className="secondary-button full" onClick={onClear}>
        <Trash2 />
        清空当前字幕
      </button>
    </div>
  );
}

function modeLabel(mode: DisplayMode): string {
  return { source: "原文", translated: "译文", bilingual: "双语" }[mode];
}
