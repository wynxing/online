import { Activity, BookOpen, ExternalLink, History, Settings, Wifi, WifiOff } from "lucide-react";
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
  saveConfig,
  startSession,
  stopSession,
  testAsr,
  testTranslation,
  updateGlossaryTerm,
} from "./api";
import { useSubtitleSocket } from "./hooks/useSubtitleSocket";
import { ControlPanel } from "./components/ControlPanel";
import { SubtitlePanel } from "./components/SubtitlePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { GlossaryPanel } from "./components/GlossaryPanel";
import { FloatingSubtitles } from "./components/FloatingSubtitles";
import { NavButton } from "./components/common/NavButton";
import type {
  Device,
  GlossaryTerm,
  RuntimeConfig,
  SessionRecord,
  SubtitleSegment,
  Tab,
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
  asrConcurrency: 2,
  translationConcurrency: 3,
  segmentMinDuration: 1.2,
  segmentMaxDuration: 3.0,
  segmentSilenceDuration: 0.35,
  diagnosticsEnabled: true,
};

function normalizeConfig(config: RuntimeConfig): RuntimeConfig {
  return { ...defaultConfig, ...config };
}

function preferLoopbackConfig(config: RuntimeConfig, devices: Device[]): RuntimeConfig {
  if (config.asrProvider === "mock") {
    return config;
  }
  const selected = devices.find((device) => device.id === config.defaultInputDeviceId);
  if (selected?.kind === "system") {
    return config;
  }
  const loopback = devices.find(
    (device) => device.kind === "system" && device.id.startsWith("wasapi_loopback_")
  );
  return loopback ? { ...config, defaultInputDeviceId: loopback.id } : config;
}

function visibleSubtitleSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  return segments.filter((segment) => !segment.supersededBy);
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
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    kind: string;
    ok: boolean;
    message: string;
  } | null>(null);
  const {
    segments,
    setSegments,
    sessionStatus,
    socketStatus,
    correctedIds,
    errorLog,
    setErrorLog,
    diagnostics,
    setDiagnostics,
  } = useSubtitleSocket();

  const visibleSegments = useMemo(() => visibleSubtitleSegments(segments), [segments]);
  const sourceDevice = devices.find((device) => device.id === config.defaultInputDeviceId);
  const isRunning = sessionStatus === "running";

  const bootstrapId = useRef(0);

  useEffect(() => {
    void bootstrap();
  }, []);

  // 设备列表轮询：Runtime 已连接后每 5 秒刷新一次
  useEffect(() => {
    if (notice !== "Runtime 已连接") return;
    const timer = window.setInterval(() => {
      void getDevices()
        .then(setDevices)
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, [notice]);

  async function bootstrap(retries = 20, delayMs = 1000) {
    const id = ++bootstrapId.current;
    for (let attempt = 1; attempt <= retries; attempt++) {
      // 如果更新的 bootstrap 已经启动，放弃当前循环
      if (id !== bootstrapId.current) return;
      try {
        await health();
        if (id !== bootstrapId.current) return;
        const [runtimeConfig, runtimeDevices, runtimeGlossary, runtimeSessions] = await Promise.all(
          [getConfig(), getDevices(), getGlossary(), getSessions()]
        );
        if (id !== bootstrapId.current) return;
        setConfig(preferLoopbackConfig(normalizeConfig(runtimeConfig), runtimeDevices));
        setDevices(runtimeDevices);
        setGlossary(runtimeGlossary);
        setSessions(runtimeSessions);
        setNotice("Runtime 已连接");
        return;
      } catch (error: unknown) {
        if (id !== bootstrapId.current) return;
        if (attempt < retries) {
          setNotice(`Runtime 启动中... (${attempt}/${retries})`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        const message =
          error instanceof TypeError
            ? "后端未运行，请先启动 Runtime（端口 8765）"
            : error instanceof Error
              ? error.message
              : String(error);
        setNotice(`Runtime 未启动：${message}`);
      }
    }
  }

  async function handleStart() {
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
      setDiagnostics({ droppedCount: 0, lowEnergyDrops: 0 });
      setActiveSession(record);
      setNotice("同传会话已启动");
    } catch (err: unknown) {
      const message =
        err instanceof TypeError
          ? "后端未运行，请先启动 Runtime（端口 8765）"
          : err instanceof Error
            ? err.message
            : String(err);
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
    setConfig(normalizeConfig(saved));
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
        title: "AI 同传字幕",
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
    setGlossary((current) =>
      [...current, created].sort((a, b) => a.source.localeCompare(b.source))
    );
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

  async function handleTestAsr() {
    setTesting("asr");
    setTestResult(null);
    try {
      const res = await testAsr(config);
      setTestResult({ kind: "asr", ok: true, message: `连接正常：${res.base_url}` });
    } catch (err) {
      setTestResult({
        kind: "asr",
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(null);
    }
  }

  async function handleTestTranslation() {
    setTesting("translation");
    setTestResult(null);
    try {
      const res = await testTranslation(config);
      setTestResult({
        kind: "translation",
        ok: true,
        message: `连接正常，示例翻译：${res.sample}`,
      });
    } catch (err) {
      setTestResult({
        kind: "translation",
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(null);
    }
  }

  const tabTitle: Record<Tab, string> = {
    console: "实时同传控制台",
    settings: "运行时与 AI 设置",
    history: "会话历史",
    glossary: "术语表管理",
  };

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
          <NavButton
            active={tab === "console"}
            icon={<Activity />}
            label="控制台"
            onClick={() => setTab("console")}
          />
          <NavButton
            active={tab === "settings"}
            icon={<Settings />}
            label="设置"
            onClick={() => setTab("settings")}
          />
          <NavButton
            active={tab === "history"}
            icon={<History />}
            label="历史"
            onClick={() => setTab("history")}
          />
          <NavButton
            active={tab === "glossary"}
            icon={<BookOpen />}
            label="术语表"
            onClick={() => setTab("glossary")}
          />
        </nav>
        <div className="runtime-card">
          <span
            className={`status-dot ${socketStatus === "connected" && notice === "Runtime 已连接" ? "connected" : socketStatus}`}
          />
          <div>
            <strong>
              {notice === "Runtime 已连接"
                ? "Runtime 在线"
                : notice.startsWith("Runtime 启动中")
                  ? "Runtime 启动中"
                  : socketStatus === "connected"
                    ? "WebSocket 在线"
                    : "WebSocket 离线"}
            </strong>
            <span>{notice}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">EN TO ZH-CN</span>
            <h1>{tabTitle[tab]}</h1>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={() => void bootstrap()}
              title="刷新 Runtime 状态"
            >
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
            <ControlPanel
              config={config}
              setConfig={setConfig}
              devices={devices}
              isRunning={isRunning}
              onStart={() => void handleStart()}
              onStop={() => void handleStop()}
              onClear={() => setSegments([])}
            />
            <SubtitlePanel
              segments={segments}
              displayMode={config.displayMode}
              correctedIds={correctedIds}
              sessionStatus={sessionStatus}
              activeSessionTitle={activeSession?.title}
              isRunning={isRunning}
              asrProvider={config.asrProvider}
              diagnostics={diagnostics}
              diagnosticsEnabled={config.diagnosticsEnabled}
              errorLog={errorLog}
            />
            <div className="latest-panel">
              <span className="eyebrow">Latest Stable</span>
              {visibleSegments.length > 0 ? (
                (() => {
                  const latest =
                    [...visibleSegments].reverse().find((s) => s.status !== "interim") ??
                    visibleSegments[visibleSegments.length - 1];
                  return (
                    <>
                      <p className="latest-source">{latest.sourceText}</p>
                      <p className="latest-translation">{latest.translatedText}</p>
                    </>
                  );
                })()
              ) : (
                <p className="latest-placeholder">暂无稳定字幕。</p>
              )}
            </div>
          </section>
        )}

        {tab === "settings" && (
          <SettingsPanel
            config={config}
            setConfig={setConfig}
            testing={testing}
            testResult={testResult}
            onTestAsr={() => void handleTestAsr()}
            onTestTranslation={() => void handleTestTranslation()}
            onSave={() => void handleSaveConfig()}
          />
        )}

        {tab === "history" && (
          <HistoryPanel
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            historySegments={historySegments}
            onSelectSession={(id) => void loadHistory(id)}
          />
        )}

        {tab === "glossary" && (
          <GlossaryPanel
            glossary={glossary}
            newTerm={newTerm}
            setNewTerm={setNewTerm}
            onAdd={(e) => void addGlossaryTerm(e)}
            onToggle={(term) => void toggleGlossary(term)}
            onRemove={(id) => void removeGlossaryTerm(id)}
          />
        )}
      </main>
    </div>
  );
}
