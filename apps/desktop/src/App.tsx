import {
  Activity,
  BookOpen,
  Captions,
  ExternalLink,
  History,
  Mic,
  MonitorSpeaker,
  Play,
  Plus,
  Save,
  Settings,
  SlidersHorizontal,
  Square,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  getConfig,
  getDevices,
  getGlossary,
  getSessionSegments,
  getSessions,
  health,
  RUNTIME_WS,
  saveConfig,
  startSession,
  stopSession,
  updateGlossaryTerm,
} from "./api";
import { mergeSegment } from "./subtitleState";
import type {
  Device,
  DisplayMode,
  GlossaryTerm,
  RuntimeConfig,
  RuntimeErrorPayload,
  RuntimeEvent,
  SessionRecord,
  SubtitleSegment,
} from "./types";

const defaultConfig: RuntimeConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  translationModel: "gpt-4o-mini",
  asrProvider: "mock",
  translationProvider: "openai-compatible",
  defaultInputDeviceId: "system_loopback",
  displayMode: "bilingual",
  fontSize: 24,
  glossaryEnabled: true,
  asrBaseUrl: "",
  asrApiKey: "",
  asrModel: "whisper-1",
  asrLanguage: "en",
  asrFormat: "whisper",
};

type Tab = "console" | "settings" | "history" | "glossary";
type RuntimeStatus = "checking" | "connected" | "disconnected";

interface ErrorLogEntry {
  code: string;
  message: string;
  time: string;
}

function useSubtitleSocket() {
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [sessionStatus, setSessionStatus] = useState("idle");
  const [socketStatus, setSocketStatus] = useState<RuntimeStatus>("checking");
  const [correctedIds, setCorrectedIds] = useState<Set<string>>(new Set());
  const [errorLog, setErrorLog] = useState<ErrorLogEntry[]>([]);
  const reconnectTimer = useRef<number>();

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | undefined;

    const connect = () => {
      socket = new WebSocket(RUNTIME_WS);
      socket.onopen = () => setSocketStatus("connected");
      socket.onclose = () => {
        setSocketStatus("disconnected");
        if (!closed) {
          reconnectTimer.current = window.setTimeout(connect, 1200);
        }
      };
      socket.onerror = () => setSocketStatus("disconnected");
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data) as RuntimeEvent;
        if (event.type === "session.status") {
          const payload = event.payload as { status?: string };
          setSessionStatus(payload.status ?? "connected");
          return;
        }
        if (
          event.type === "segment.created" ||
          event.type === "segment.updated" ||
          event.type === "segment.corrected"
        ) {
          const segment = event.payload as SubtitleSegment;
          setSegments((current) => mergeSegment(current, segment));
          if (event.type === "segment.corrected") {
            setCorrectedIds((current) => new Set(current).add(segment.id));
            window.setTimeout(() => {
              setCorrectedIds((current) => {
                const next = new Set(current);
                next.delete(segment.id);
                return next;
              });
            }, 2200);
          }
          return;
        }
        if (event.type === "runtime.error") {
          const err = event.payload as RuntimeErrorPayload;
          setErrorLog((prev) => [
            { code: err.code, message: err.message, time: new Date().toLocaleTimeString() },
            ...prev,
          ]);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer.current);
      socket?.close();
    };
  }, []);

  return {
    segments,
    setSegments,
    sessionStatus,
    socketStatus,
    correctedIds,
    errorLog,
    setErrorLog,
  };
}

export function App() {
  const isFloating = new URLSearchParams(window.location.search).get("view") === "floating";
  if (isFloating) {
    return <FloatingSubtitles />;
  }
  return <MainConsole />;
}

function MainConsole() {
  const [tab, setTab] = useState<Tab>("console");
  const [devices, setDevices] = useState<Device[]>([]);
  const [config, setConfig] = useState<RuntimeConfig>(defaultConfig);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [historySegments, setHistorySegments] = useState<SubtitleSegment[]>([]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);
  const [newTerm, setNewTerm] = useState({ source: "", target: "", domain: "" });
  const [notice, setNotice] = useState("Runtime 未检测");
  const subtitlePaneRef = useRef<HTMLDivElement>(null);
  const { segments, setSegments, sessionStatus, socketStatus, correctedIds, errorLog, setErrorLog } = useSubtitleSocket();

  const latestSegment =
    [...segments].reverse().find((segment) => segment.status !== "interim") ?? segments[segments.length - 1];
  const sourceDevice = devices.find((device) => device.id === config.defaultInputDeviceId);
  const isRunning = sessionStatus === "running";

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    const pane = subtitlePaneRef.current;
    if (pane) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [segments.length]);

  async function bootstrap() {
    try {
      await health();
      const [runtimeConfig, runtimeDevices, runtimeGlossary, runtimeSessions] = await Promise.all([
        getConfig(),
        getDevices(),
        getGlossary(),
        getSessions(),
      ]);
      setConfig(runtimeConfig);
      setDevices(runtimeDevices);
      setGlossary(runtimeGlossary);
      setSessions(runtimeSessions);
      setNotice("Runtime 已连接");
    } catch (error) {
      setNotice(`Runtime 未启动：${String(error)}`);
    }
  }

  async function handleStart() {
    // 真实模式前端校验
    if (config.asrProvider !== "mock") {
      const errors: string[] = [];
      const asrKey = config.asrApiKey || config.apiKey;
      const asrUrl = config.asrBaseUrl || config.baseUrl;
      if (!asrUrl) errors.push("ASR 服务地址未配置");
      if (!asrKey) errors.push("ASR API Key 未配置");
      if (!config.apiKey) errors.push("翻译 API Key 未配置");
      if (sourceDevice?.kind === "mock") errors.push("请选择真实的音频输入设备");
      if (errors.length > 0) {
        setNotice(`无法启动：${errors.join("；")}`);
        return;
      }
    }

    try {
      const record = await startSession({
        inputDeviceId: config.defaultInputDeviceId,
        sourceLang: "en",
        targetLang: "zh-CN",
        displayMode: config.displayMode,
        asrProvider: config.asrProvider,
        translationProvider: config.translationProvider,
      });
      setSegments([]);
      setErrorLog([]);
      setActiveSession(record);
      setNotice("同传会话已启动");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice(`启动失败：${message}`);
    }
  }

  async function handleStop() {
    const result = await stopSession();
    if ("id" in result) {
      setActiveSession(result);
    }
    setSessions(await getSessions());
    setNotice("同传会话已停止并保存");
  }

  async function handleSaveConfig() {
    const saved = await saveConfig(config);
    setConfig(saved);
    setNotice("配置已保存");
  }

  async function openFloatingWindow() {
    const tauriAvailable = "__TAURI_INTERNALS__" in window;
    if (tauriAvailable) {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel("floating-subtitles");
      if (existing) {
        await existing.setFocus();
        return;
      }
      new WebviewWindow("floating-subtitles", {
        url: "/?view=floating",
        title: "AI 同声传译字幕",
        width: 960,
        height: 260,
        minWidth: 520,
        minHeight: 180,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: true,
      });
      return;
    }
    window.open("/?view=floating", "floating-subtitles", "width=960,height=260");
  }

  async function loadHistory(sessionId: string) {
    setSelectedSessionId(sessionId);
    setHistorySegments(await getSessionSegments(sessionId));
  }

  async function addGlossaryTerm(event: FormEvent) {
    event.preventDefault();
    if (!newTerm.source.trim() || !newTerm.target.trim()) {
      return;
    }
    const created = await createGlossaryTerm({
      source: newTerm.source.trim(),
      target: newTerm.target.trim(),
      domain: newTerm.domain.trim() || undefined,
      enabled: true,
    });
    setGlossary((current) => [...current, created].sort((a, b) => a.source.localeCompare(b.source)));
    setNewTerm({ source: "", target: "", domain: "" });
  }

  async function toggleGlossary(term: GlossaryTerm) {
    const updated = await updateGlossaryTerm({ ...term, enabled: !term.enabled });
    setGlossary((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function removeGlossaryTerm(id: string) {
    await deleteGlossaryTerm(id);
    setGlossary((current) => current.filter((item) => item.id !== id));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">AI</span>
          <div>
            <strong>同声传译助手</strong>
            <span>实时双语字幕工作台</span>
          </div>
        </div>
        <nav className="nav-list">
          <NavButton active={tab === "console"} icon={<Activity />} label="控制台" onClick={() => setTab("console")} />
          <NavButton active={tab === "settings"} icon={<Settings />} label="设置" onClick={() => setTab("settings")} />
          <NavButton active={tab === "history"} icon={<History />} label="历史" onClick={() => setTab("history")} />
          <NavButton active={tab === "glossary"} icon={<BookOpen />} label="术语表" onClick={() => setTab("glossary")} />
        </nav>
        <div className="runtime-card">
          <span className={`status-dot ${socketStatus}`} />
          <div>
            <strong>{socketStatus === "connected" ? "WebSocket 在线" : "WebSocket 离线"}</strong>
            <span>{notice}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">EN → ZH-CN</span>
            <h1>{tabTitle(tab)}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-button" onClick={() => void bootstrap()} title="刷新 Runtime 状态">
              {socketStatus === "connected" ? <Wifi /> : <WifiOff />}
            </button>
            <button className="secondary-button" onClick={() => void openFloatingWindow()}>
              <ExternalLink />
              悬浮字幕
            </button>
          </div>
        </header>

        {tab === "console" && (
          <section className="console-grid">
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
                  ? "✓ 已选择系统音频 loopback，可采集播放声音"
                  : sourceDevice?.kind === "microphone"
                    ? "⚠ 当前选择的是麦克风，只能采集麦克风声音。要采集系统播放声音，请选择带 [Loopback] 的设备"
                    : sourceDevice?.description ?? "请选择音频输入设备"}
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
                  <option value="openai-compatible">真实识别（OpenAI 兼容）</option>
                </select>
              </label>
              <div className="run-controls">
                <button className="primary-button" disabled={isRunning} onClick={() => void handleStart()}>
                  <Play />
                  开始同传
                </button>
                <button className="danger-button" disabled={!isRunning} onClick={() => void handleStop()}>
                  <Square />
                  停止
                </button>
              </div>
              <button className="secondary-button full" onClick={() => setSegments([])}>
                <Trash2 />
                清空当前字幕
              </button>
            </div>

            <div className="subtitle-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Live Stream</span>
                  <h2>实时字幕</h2>
                </div>
                <Captions />
              </div>
              <div className="session-strip">
                <StatusPill label="会话" value={activeSession?.title ?? "未启动"} />
                <StatusPill label="状态" value={sessionStatus} />
                <StatusPill label="段数" value={String(segments.length)} />
                <StatusPill label="模式" value={config.asrProvider === "mock" ? "Mock" : "真实"} />
              </div>
              {errorLog.length > 0 && (
                <div className="error-log">
                  {errorLog.slice(0, 5).map((err, i) => (
                    <div key={i} className="error-entry">
                      <span className="error-time">{err.time}</span>
                      <span className="error-code">{err.code}</span>
                      <span className="error-msg">{err.message}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="subtitle-list" ref={subtitlePaneRef}>
                {segments.length === 0 ? (
                  <EmptyState title="等待字幕流" body="启动会话后，mock 管线会模拟实时识别、翻译和修正事件。" />
                ) : (
                  segments.map((segment) => (
                    <SubtitleRow
                      key={segment.id}
                      segment={segment}
                      displayMode={config.displayMode}
                      corrected={correctedIds.has(segment.id)}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="latest-panel">
              <span className="eyebrow">Latest Stable</span>
              {latestSegment ? (
                <>
                  <p className="latest-source">{latestSegment.sourceText}</p>
                  <p className="latest-translation">{latestSegment.translatedText}</p>
                </>
              ) : (
                <p className="latest-placeholder">暂无稳定字幕。</p>
              )}
            </div>
          </section>
        )}

        {tab === "settings" && (
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
                  <option value="whisper">Whisper（/v1/audio/transcriptions）</option>
                  <option value="chat-completions">Chat Completions（/v1/chat/completions）</option>
                </select>
              </label>
              <div className="device-note">
                {config.asrFormat === "whisper"
                  ? "Whisper 格式：音频以文件方式上传，适用于 OpenAI、Groq 等服务。"
                  : "Chat Completions 格式：音频以 base64 编码发送，适用于小米 MiMo、智谱等国内服务。"}
              </div>
              <label className="field">
                <span>ASR 服务地址</span>
                <input
                  value={config.asrBaseUrl}
                  placeholder="留空则使用翻译服务地址"
                  onChange={(event) => setConfig({ ...config, asrBaseUrl: event.target.value })}
                />
              </label>
              <div className="device-note">
                地址需要包含 /v1，例如：https://api.xiaomimimo.com/v1
              </div>
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
                  onChange={(event) => setConfig({ ...config, fontSize: Number(event.target.value) })}
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
              <button className="primary-button" onClick={() => void handleSaveConfig()}>
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
        )}

        {tab === "history" && (
          <section className="history-grid">
            <div className="history-list">
              {sessions.length === 0 ? (
                <EmptyState title="暂无历史记录" body="停止一次会话后，最终字幕会保存到 SQLite。" />
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    className={`history-item ${selectedSessionId === session.id ? "active" : ""}`}
                    onClick={() => void loadHistory(session.id)}
                  >
                    <strong>{session.title}</strong>
                    <span>{formatDate(session.startedAt)}</span>
                  </button>
                ))
              )}
            </div>
            <div className="history-detail">
              {historySegments.length === 0 ? (
                <EmptyState title="选择一条会话" body="这里会展示该会话保存下来的最终字幕和修正字幕。" />
              ) : (
                historySegments.map((segment) => (
                  <SubtitleRow key={segment.id} segment={segment} displayMode="bilingual" corrected={false} />
                ))
              )}
            </div>
          </section>
        )}

        {tab === "glossary" && (
          <section className="glossary-grid">
            <form className="form-panel" onSubmit={(event) => void addGlossaryTerm(event)}>
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">Glossary</span>
                  <h2>新增术语</h2>
                </div>
                <BookOpen />
              </div>
              <label className="field">
                <span>英文术语</span>
                <input value={newTerm.source} onChange={(event) => setNewTerm({ ...newTerm, source: event.target.value })} />
              </label>
              <label className="field">
                <span>中文译法</span>
                <input value={newTerm.target} onChange={(event) => setNewTerm({ ...newTerm, target: event.target.value })} />
              </label>
              <label className="field">
                <span>领域</span>
                <input value={newTerm.domain} onChange={(event) => setNewTerm({ ...newTerm, domain: event.target.value })} />
              </label>
              <button className="primary-button" type="submit">
                <Plus />
                添加术语
              </button>
            </form>
            <div className="terms-panel">
              {glossary.map((term) => (
                <div className="term-row" key={term.id}>
                  <button className={`switch ${term.enabled ? "on" : ""}`} onClick={() => void toggleGlossary(term)} />
                  <div>
                    <strong>{term.source}</strong>
                    <span>{term.target}</span>
                  </div>
                  <small>{term.domain ?? "General"}</small>
                  <button className="icon-button" title="删除术语" onClick={() => void removeGlossaryTerm(term.id)}>
                    <Trash2 />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function FloatingSubtitles() {
  const { segments, correctedIds, socketStatus } = useSubtitleSocket();
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    (window.localStorage.getItem("floatingDisplayMode") as DisplayMode) || "bilingual",
  );
  const latest = useMemo(
    () => [...segments].reverse().find((segment) => segment.status !== "interim") ?? segments[segments.length - 1],
    [segments],
  );

  useEffect(() => {
    window.localStorage.setItem("floatingDisplayMode", displayMode);
  }, [displayMode]);

  return (
    <div className="floating-shell">
      <div className="floating-toolbar" data-tauri-drag-region>
        <span className={`status-dot ${socketStatus}`} />
        <span data-tauri-drag-region>AI 同传字幕</span>
        <div className="floating-modes">
          {(["source", "translated", "bilingual"] as DisplayMode[]).map((mode) => (
            <button
              key={mode}
              className={displayMode === mode ? "active" : ""}
              onClick={() => setDisplayMode(mode)}
            >
              {modeLabel(mode)}
            </button>
          ))}
        </div>
      </div>
      <div className={`floating-card ${latest && correctedIds.has(latest.id) ? "corrected" : ""}`}>
        {latest ? (
          <SubtitleContent segment={latest} displayMode={displayMode} />
        ) : (
          <span className="floating-empty">等待同传会话开始...</span>
        )}
      </div>
    </div>
  );
}

function NavButton(props: { active: boolean; icon: JSX.Element; label: string; onClick: () => void }) {
  return (
    <button className={`nav-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function StatusPill(props: { label: string; value: string }) {
  return (
    <div className="status-pill">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function SubtitleRow(props: { segment: SubtitleSegment; displayMode: DisplayMode; corrected: boolean }) {
  return (
    <article className={`subtitle-row ${props.segment.status} ${props.corrected ? "flash" : ""}`}>
      <div className="subtitle-meta">
        <span>{props.segment.id}</span>
        <strong>v{props.segment.version}</strong>
        <em>{props.segment.status}</em>
      </div>
      <SubtitleContent segment={props.segment} displayMode={props.displayMode} />
    </article>
  );
}

function SubtitleContent(props: { segment: SubtitleSegment; displayMode: DisplayMode }) {
  return (
    <div className="subtitle-content">
      {(props.displayMode === "source" || props.displayMode === "bilingual") && (
        <p className="source-text">{props.segment.sourceText}</p>
      )}
      {(props.displayMode === "translated" || props.displayMode === "bilingual") && (
        <p className="translated-text">{props.segment.translatedText}</p>
      )}
    </div>
  );
}

function EmptyState(props: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{props.title}</strong>
      <span>{props.body}</span>
    </div>
  );
}

function modeLabel(mode: DisplayMode) {
  return {
    source: "原文",
    translated: "译文",
    bilingual: "双语",
  }[mode];
}

function tabTitle(tab: Tab) {
  return {
    console: "实时同传控制台",
    settings: "运行时与 AI 设置",
    history: "会话历史",
    glossary: "术语表管理",
  }[tab];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
