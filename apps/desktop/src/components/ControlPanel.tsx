import { Mic, MonitorSpeaker, Play, Square, Trash2 } from "lucide-react";
import { t, useLang } from "../i18n";
import type { Lang } from "../i18n";
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
  const lang = useLang();
  const sourceDevice = devices.find((device) => device.id === config.defaultInputDeviceId);

  return (
    <div className="control-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{t("controlPanel.input", lang)}</span>
          <h2>{t("controlPanel.audioSource", lang)}</h2>
        </div>
        {sourceDevice?.kind === "system" ? <MonitorSpeaker /> : <Mic />}
      </div>
      <label className="field">
        <span>{t("controlPanel.captureSource", lang)}</span>
        <select
          value={config.defaultInputDeviceId}
          onChange={(event) => setConfig({ ...config, defaultInputDeviceId: event.target.value })}
        >
          {devices.length === 0 && <option value="">{t("controlPanel.noDevices", lang)}</option>}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {deviceLabel(device)}
            </option>
          ))}
        </select>
      </label>
      <div className="device-note">
        {sourceDevice
          ? selectedDeviceNote(sourceDevice, lang)
          : t("controlPanel.selectDeviceHint", lang)}
      </div>
      <div className="segmented">
        {(["source", "translated", "bilingual"] as DisplayMode[]).map((mode) => (
          <button
            key={mode}
            className={config.displayMode === mode ? "active" : ""}
            onClick={() => setConfig({ ...config, displayMode: mode })}
          >
            {modeLabel(mode, lang)}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t("controlPanel.recognitionMode", lang)}</span>
        <select
          value={config.asrProvider}
          onChange={(event) => setConfig({ ...config, asrProvider: event.target.value })}
        >
          <option value="openai-compatible">{t("controlPanel.asrModeOpenAI", lang)}</option>
        </select>
      </label>
      <div className="run-controls">
        <button className="primary-button" disabled={isRunning} onClick={onStart}>
          <Play />
          {t("controlPanel.start", lang)}
        </button>
        <button className="danger-button" disabled={!isRunning} onClick={onStop}>
          <Square />
          {t("controlPanel.stop", lang)}
        </button>
      </div>
      <button className="secondary-button full" onClick={onClear}>
        <Trash2 />
        {t("controlPanel.clearSubtitles", lang)}
      </button>
    </div>
  );
}

function modeLabel(mode: DisplayMode, lang: Lang): string {
  return {
    source: t("controlPanel.mode.source", lang),
    translated: t("controlPanel.mode.translated", lang),
    bilingual: t("controlPanel.mode.bilingual", lang),
  }[mode];
}

function deviceLabel(device: Device): string {
  return device.displayName ?? device.name;
}

function selectedDeviceNote(device: Device, lang: Lang): string {
  const details = [
    device.description,
    device.isDefault ? t("controlPanel.defaultDevice", lang) : undefined,
    `${t("controlPanel.deviceId", lang)}: ${device.id}`,
  ].filter(Boolean);
  return details.join(" ");
}
