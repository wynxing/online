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
            <h2>语音识别服务</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <label className="field">
          <span>接口格式</span>
          <select
            value={config.asrFormat}
            onChange={(event) => setConfig({ ...config, asrFormat: event.target.value })}
          >
            <option value="whisper">标准 ASR（/v1/audio/transcriptions）</option>
            <option value="chat-completions">Chat Completions（/v1/chat/completions）</option>
          </select>
        </label>
        <div className="device-note">
          {config.asrFormat === "whisper"
            ? "标准 ASR 格式：音频以文件方式上传，适用于兼容 Whisper API 的服务。"
            : "Chat Completions 格式：音频以 base64 编码发送，适用于兼容的 Chat Completions 服务。"}
        </div>
        <label className="field">
          <span>ASR 服务地址</span>
          <input
            value={config.asrBaseUrl}
            placeholder="留空则使用翻译服务地址"
            onChange={(event) => setConfig({ ...config, asrBaseUrl: event.target.value })}
          />
        </label>
        <div className="device-note">地址通常需要包含 /v1 后缀</div>
        <label className="field">
          <span>ASR API Key</span>
          <input
            type="password"
            value={config.asrApiKey}
            placeholder="留空则使用翻译服务 Key"
            onChange={(event) => setConfig({ ...config, asrApiKey: event.target.value })}
          />
        </label>
        <label className="field">
          <span>ASR 模型</span>
          <input
            value={config.asrModel}
            onChange={(event) => setConfig({ ...config, asrModel: event.target.value })}
          />
        </label>
        <label className="field">
          <span>识别语言</span>
          <input
            value={config.asrLanguage}
            placeholder="en / zh / auto"
            onChange={(event) => setConfig({ ...config, asrLanguage: event.target.value })}
          />
        </label>
        <button className="secondary-button" disabled={testing !== null} onClick={onTestAsr}>
          {testing === "asr" ? "测试中..." : "测试 ASR 连接"}
        </button>
        {testResult?.kind === "asr" && (
          <div className={`test-result ${testResult.ok ? "ok" : "fail"}`}>
            {testResult.ok ? "✓" : "✗"} {testResult.message}
          </div>
        )}

        <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
          <div>
            <span className="eyebrow">Translation</span>
            <h2>翻译服务</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <label className="field">
          <span>Base URL</span>
          <input value={config.baseUrl} onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })} />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={config.apiKey}
            placeholder="演示版可留空"
            onChange={(event) => setConfig({ ...config, apiKey: event.target.value })}
          />
        </label>
        <label className="field">
          <span>翻译模型</span>
          <input
            value={config.translationModel}
            onChange={(event) => setConfig({ ...config, translationModel: event.target.value })}
          />
        </label>
        <button className="secondary-button" disabled={testing !== null} onClick={onTestTranslation}>
          {testing === "translation" ? "测试中..." : "测试翻译连接"}
        </button>
        {testResult?.kind === "translation" && (
          <div className={`test-result ${testResult.ok ? "ok" : "fail"}`}>
            {testResult.ok ? "✓" : "✗"} {testResult.message}
          </div>
        )}

        <div className="panel-heading" style={{ marginTop: "1.5rem" }}>
          <div>
            <span className="eyebrow">Performance</span>
            <h2>实时管线</h2>
          </div>
          <SlidersHorizontal />
        </div>
        <div className="settings-columns">
          <label className="field">
            <span>ASR 并发</span>
            <input
              type="number"
              min="1"
              max="8"
              value={config.asrConcurrency}
              onChange={(event) => updateConfigNumber("asrConcurrency", event.target.value)}
            />
          </label>
          <label className="field">
            <span>翻译并发</span>
            <input
              type="number"
              min="1"
              max="8"
              value={config.translationConcurrency}
              onChange={(event) => updateConfigNumber("translationConcurrency", event.target.value)}
            />
          </label>
          <label className="field">
            <span>最短分段秒数</span>
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
            <span>最长分段秒数</span>
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
            <span>静音切分秒数</span>
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
            <h2>显示设置</h2>
          </div>
        </div>
        <label className="field">
          <span>字幕字号</span>
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
          <span>翻译时注入启用术语表</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config.diagnosticsEnabled}
            onChange={(event) => setConfig({ ...config, diagnosticsEnabled: event.target.checked })}
          />
          <span>显示实时诊断指标</span>
        </label>
        <button className="primary-button" onClick={onSave}>
          <Save />
          保存配置
        </button>
      </div>
      <div className="preview-panel">
        <span className="eyebrow">Subtitle Preview</span>
        <div className="subtitle-preview" style={{ fontSize: config.fontSize }}>
          <span>We use caching to reduce latency.</span>
          <strong>我们使用缓存来降低延迟。</strong>
        </div>
      </div>
    </section>
  );
}
