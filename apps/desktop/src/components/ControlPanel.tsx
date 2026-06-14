import { Mic, MonitorSpeaker, Play, Square, Trash2 } from "lucide-react";
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

export function ControlPanel({
  config,
  setConfig,
  devices,
  isRunning,
  onStart,
  onStop,
  onClear,
}: ControlPanelProps) {
  const sourceDevice = devices.find((device) => device.id === config.defaultInputDeviceId);

  return (
    <div className="control-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Input</span>
          <h2>Audio source</h2>
        </div>
        {sourceDevice?.kind === "system" ? <MonitorSpeaker /> : <Mic />}
      </div>
      <label className="field">
        <span>Capture source</span>
        <select
          value={config.defaultInputDeviceId}
          onChange={(event) => setConfig({ ...config, defaultInputDeviceId: event.target.value })}
        >
          {devices.length === 0 && <option value="">No input devices found</option>}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {deviceLabel(device)}
            </option>
          ))}
        </select>
      </label>
      <div className="device-note">
        {sourceDevice
          ? selectedDeviceNote(sourceDevice)
          : "Select an input device for real-time capture."}
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
        <span>Recognition mode</span>
        <select
          value={config.asrProvider}
          onChange={(event) => setConfig({ ...config, asrProvider: event.target.value })}
        >
          <option value="openai-compatible">OpenAI-compatible ASR</option>
        </select>
      </label>
      <div className="run-controls">
        <button className="primary-button" disabled={isRunning} onClick={onStart}>
          <Play />
          Start
        </button>
        <button className="danger-button" disabled={!isRunning} onClick={onStop}>
          <Square />
          Stop
        </button>
      </div>
      <button className="secondary-button full" onClick={onClear}>
        <Trash2 />
        Clear subtitles
      </button>
    </div>
  );
}

function modeLabel(mode: DisplayMode): string {
  return { source: "Source", translated: "Translation", bilingual: "Bilingual" }[mode];
}

function deviceLabel(device: Device): string {
  return device.displayName ?? device.name;
}

function selectedDeviceNote(device: Device): string {
  const details = [
    device.description,
    device.isDefault ? "Default device." : undefined,
    `Device id: ${device.id}`,
  ].filter(Boolean);
  return details.join(" ");
}
