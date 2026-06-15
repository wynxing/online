import { Save, SlidersHorizontal } from "lucide-react";
import { t, useLang } from "../i18n";
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
  const lang = useLang();
  function updateConfigNumber(key: keyof RuntimeConfig, value: string) {
    setConfig({ ...config, [key]: Number(value) });
  }

  return (
    <section className="settings-grid">
      <div className="form-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{t("settings.asrSection", lang)}</span>
            <h2>{t("settings.speechRecognition", lang)}</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <label className="field">
          <span>{t("settings.apiFormat", lang)}</span>
          <select
            value={config.asrFormat}
            onChange={(event) => setConfig({ ...config, asrFormat: event.target.value })}
          >
            <option value="whisper">{t("settings.asrFormatWhisper", lang)}</option>
            <option value="chat-completions">{t("settings.asrFormatChat", lang)}</option>
          </select>
        </label>
        <div className="device-note">
          {config.asrFormat === "whisper"
            ? t("settings.asrFormatWhisperHint", lang)
            : t("settings.asrFormatChatHint", lang)}
        </div>
        <label className="field">
          <span>{t("settings.asrBaseUrl", lang)}</span>
          <input
            value={config.asrBaseUrl}
            placeholder={t("settings.asrBaseUrlPlaceholder", lang)}
            onChange={(event) => setConfig({ ...config, asrBaseUrl: event.target.value })}
          />
        </label>
        <div className="device-note">{t("settings.urlV1Hint", lang)}</div>
        <label className="field">
          <span>{t("settings.asrApiKey", lang)}</span>
          <input
            type="password"
            value={config.asrApiKey}
            placeholder={t("settings.asrApiKeyPlaceholder", lang)}
            onChange={(event) => setConfig({ ...config, asrApiKey: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("settings.asrModel", lang)}</span>
          <input
            value={config.asrModel}
            onChange={(event) => setConfig({ ...config, asrModel: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("settings.recognitionLanguage", lang)}</span>
          <input
            value={config.asrLanguage}
            placeholder={t("settings.asrLanguagePlaceholder", lang)}
            onChange={(event) => setConfig({ ...config, asrLanguage: event.target.value })}
          />
        </label>
        <button className="secondary-button" disabled={testing !== null} onClick={onTestAsr}>
          {testing === "asr" ? t("common.testing", lang) : t("settings.testAsr", lang)}
        </button>
        {testResult?.kind === "asr" && (
          <div className={`test-result ${testResult.ok ? "ok" : "fail"}`}>
            {testResult.ok ? t("common.ok", lang) : t("common.failed", lang)}: {testResult.message}
          </div>
        )}

        <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
          <div>
            <span className="eyebrow">{t("settings.translationSection", lang)}</span>
            <h2>{t("settings.translationService", lang)}</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <label className="field">
          <span>{t("settings.baseUrl", lang)}</span>
          <input
            value={config.baseUrl}
            onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("settings.apiKey", lang)}</span>
          <input
            type="password"
            value={config.apiKey}
            onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t("settings.translationModel", lang)}</span>
          <input
            value={config.translationModel}
            onChange={(event) => setConfig({ ...config, translationModel: event.target.value })}
          />
        </label>
        <div className="settings-columns">
          <label className="field">
            <span>{t("settings.sourceLanguage", lang)}</span>
            <input
              value={config.sourceLang}
              placeholder={t("settings.sourceLanguagePlaceholder", lang)}
              onChange={(event) => setConfig({ ...config, sourceLang: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t("settings.targetLanguage", lang)}</span>
            <input
              value={config.targetLang}
              placeholder={t("settings.targetLanguagePlaceholder", lang)}
              onChange={(event) => setConfig({ ...config, targetLang: event.target.value })}
            />
          </label>
        </div>
        <button
          className="secondary-button"
          disabled={testing !== null}
          onClick={onTestTranslation}
        >
          {testing === "translation"
            ? t("common.testing", lang)
            : t("settings.testTranslation", lang)}
        </button>
        {testResult?.kind === "translation" && (
          <div className={`test-result ${testResult.ok ? "ok" : "fail"}`}>
            {testResult.ok ? t("common.ok", lang) : t("common.failed", lang)}: {testResult.message}
          </div>
        )}

        <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
          <div>
            <span className="eyebrow">{t("settings.performanceSection", lang)}</span>
            <h2>{t("settings.realtimePipeline", lang)}</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <div className="settings-columns">
          <label className="field">
            <span>{t("settings.minSegmentSeconds", lang)}</span>
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
            <span>{t("settings.maxSegmentSeconds", lang)}</span>
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
            <span>{t("settings.silenceSplitSeconds", lang)}</span>
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
        <div className="settings-columns">
          <label className="field">
            <span>{t("settings.asrConcurrency", lang)}</span>
            <input
              type="number"
              min="1"
              max="8"
              step="1"
              value={config.asrConcurrency}
              onChange={(event) => updateConfigNumber("asrConcurrency", event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("settings.translationConcurrency", lang)}</span>
            <input
              type="number"
              min="1"
              max="8"
              step="1"
              value={config.translationConcurrency}
              onChange={(event) => updateConfigNumber("translationConcurrency", event.target.value)}
            />
          </label>
        </div>

        <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
          <div>
            <span className="eyebrow">{t("settings.displaySection", lang)}</span>
            <h2>{t("settings.subtitleDisplay", lang)}</h2>
          </div>
        </div>
        <label className="field">
          <span>{t("settings.subtitleFontSize", lang)}</span>
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
          <span>{t("settings.useGlossary", lang)}</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config.diagnosticsEnabled}
            onChange={(event) => setConfig({ ...config, diagnosticsEnabled: event.target.checked })}
          />
          <span>{t("settings.showDiagnostics", lang)}</span>
        </label>
        <button className="primary-button" onClick={onSave}>
          <Save />
          {t("settings.saveConfig", lang)}
        </button>
      </div>
      <div className="preview-panel">
        <span className="eyebrow">{t("settings.subtitlePreview", lang)}</span>
        <div className="subtitle-preview" style={{ fontSize: config.fontSize }}>
          <span>{t("settings.previewSource", lang)}</span>
          <strong>{t("settings.previewTranslation", lang)}</strong>
        </div>
      </div>
    </section>
  );
}
