import { Save, SlidersHorizontal } from "lucide-react";
import type { RuntimeConfig } from "../types";

interface SettingsPanelProps {
  config: RuntimeConfig;
  setConfig: (config: RuntimeConfig) => void;
  testing: string | null;
  testResult: { kind: string; ok: boolean; message: string } | null;
  onTestAsr: () => void;
  onTestTranslation: () => void;
  onSave: () => void;
}

export function SettingsPanel({
  config,
  setConfig,
  testing,
  testResult,
  onTestAsr,
  onTestTranslation,
  onSave,
}: SettingsPanelProps) {
  function updateConfigNumber(key: keyof RuntimeConfig, value: string) {
    setConfig({ ...config, [key]: Number(value) });
  }

  return (
    <section className="settings-grid">
      <div className="form-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ASR</span>
            <h2>Speech recognition</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <label className="field">
          <span>API format</span>
          <select
            value={config.asrFormat}
            onChange={(event) => setConfig({ ...config, asrFormat: event.target.value })}
          >
            <option value="whisper">Standard ASR (/v1/audio/transcriptions)</option>
            <option value="chat-completions">Chat Completions (/v1/chat/completions)</option>
          </select>
        </label>
        <div className="device-note">
          {config.asrFormat === "whisper"
            ? "Uploads audio as a file to a Whisper-compatible transcription endpoint."
            : "Sends base64 audio to a Chat Completions-compatible endpoint."}
        </div>
        <label className="field">
          <span>ASR Base URL</span>
          <input
            value={config.asrBaseUrl}
            placeholder="Leave blank to use translation Base URL"
            onChange={(event) => setConfig({ ...config, asrBaseUrl: event.target.value })}
          />
        </label>
        <div className="device-note">The URL usually includes a /v1 suffix.</div>
        <label className="field">
          <span>ASR API Key</span>
          <input
            type="password"
            value={config.asrApiKey}
            placeholder="Leave blank to use translation API Key"
            onChange={(event) => setConfig({ ...config, asrApiKey: event.target.value })}
          />
        </label>
        <label className="field">
          <span>ASR model</span>
          <input
            value={config.asrModel}
            onChange={(event) => setConfig({ ...config, asrModel: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Recognition language</span>
          <input
            value={config.asrLanguage}
            placeholder="en / zh / auto"
            onChange={(event) => setConfig({ ...config, asrLanguage: event.target.value })}
          />
        </label>
        <button className="secondary-button" disabled={testing !== null} onClick={onTestAsr}>
          {testing === "asr" ? "Testing..." : "Test ASR connection"}
        </button>
        {testResult?.kind === "asr" && (
          <div className={`test-result ${testResult.ok ? "ok" : "fail"}`}>
            {testResult.ok ? "OK" : "Failed"}: {testResult.message}
          </div>
        )}

        <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
          <div>
            <span className="eyebrow">Translation</span>
            <h2>Translation service</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <label className="field">
          <span>Base URL</span>
          <input
            value={config.baseUrl}
            onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={config.apiKey}
            onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Translation model</span>
          <input
            value={config.translationModel}
            onChange={(event) => setConfig({ ...config, translationModel: event.target.value })}
          />
        </label>
        <div className="settings-columns">
          <label className="field">
            <span>Source language</span>
            <input
              value={config.sourceLang}
              placeholder="en"
              onChange={(event) => setConfig({ ...config, sourceLang: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Target language</span>
            <input
              value={config.targetLang}
              placeholder="zh-CN"
              onChange={(event) => setConfig({ ...config, targetLang: event.target.value })}
            />
          </label>
        </div>
        <button
          className="secondary-button"
          disabled={testing !== null}
          onClick={onTestTranslation}
        >
          {testing === "translation" ? "Testing..." : "Test translation connection"}
        </button>
        {testResult?.kind === "translation" && (
          <div className={`test-result ${testResult.ok ? "ok" : "fail"}`}>
            {testResult.ok ? "OK" : "Failed"}: {testResult.message}
          </div>
        )}

        <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
          <div>
            <span className="eyebrow">Performance</span>
            <h2>Realtime pipeline</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <div className="settings-columns">
          <label className="field">
            <span>Min segment seconds</span>
            <input
              type="number"
              min="0.4"
              max="10"
              step="0.1"
              value={config.segmentMinDuration}
              onChange={(event) => updateConfigNumber("segmentMinDuration", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Max segment seconds</span>
            <input
              type="number"
              min="0.8"
              max="20"
              step="0.1"
              value={config.segmentMaxDuration}
              onChange={(event) => updateConfigNumber("segmentMaxDuration", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Silence split seconds</span>
            <input
              type="number"
              min="0.1"
              max="3"
              step="0.05"
              value={config.segmentSilenceDuration}
              onChange={(event) => updateConfigNumber("segmentSilenceDuration", event.target.value)}
            />
          </label>
        </div>

        <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
          <div>
            <span className="eyebrow">Display</span>
            <h2>Subtitle display</h2>
          </div>
        </div>
        <label className="field">
          <span>Subtitle font size</span>
          <input
            type="range"
            min="14"
            max="56"
            value={config.fontSize}
            onChange={(event) => updateConfigNumber("fontSize", event.target.value)}
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config.glossaryEnabled}
            onChange={(event) => setConfig({ ...config, glossaryEnabled: event.target.checked })}
          />
          <span>Use glossary during translation</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config.diagnosticsEnabled}
            onChange={(event) => setConfig({ ...config, diagnosticsEnabled: event.target.checked })}
          />
          <span>Show realtime diagnostics</span>
        </label>
        <button className="primary-button" onClick={onSave}>
          <Save />
          Save configuration
        </button>
      </div>
      <div className="preview-panel">
        <span className="eyebrow">Subtitle Preview</span>
        <div className="subtitle-preview" style={{ fontSize: config.fontSize }}>
          <span>We use caching to reduce latency.</span>
          <strong>Translation preview text</strong>
        </div>
      </div>
    </section>
  );
}
