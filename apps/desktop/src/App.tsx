import { Activity, BookOpen, ExternalLink, History, Settings, Wifi, WifiOff } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  getConfig,
  getDevices,
  getGlossary,
  getSessionSegments,
  getSessions,
  saveConfig,
  startSession,
  stopSession,
  testAsr,
  testTranslation,
  updateGlossaryTerm,
} from "./api";
import { ControlPanel } from "./components/ControlPanel";
import { FloatingSubtitles } from "./components/FloatingSubtitles";
import { GlossaryPanel } from "./components/GlossaryPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { SubtitlePanel } from "./components/SubtitlePanel";
import { UpdateBanner } from "./components/UpdateBanner";
import { NavButton } from "./components/common/NavButton";
import { useSubtitleSocket } from "./hooks/useSubtitleSocket";
import { useUpdateChecker } from "./hooks/useUpdateChecker";
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
  asrProvider: "openai-compatible",
  translationProvider: "openai-compatible",
  defaultInputDeviceId: "",
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

function normalizeConfig(config: RuntimeConfig): RuntimeConfig {
  return { ...defaultConfig, ...config };
}

function preferAvailableDevice(config: RuntimeConfig, devices: Device[]): RuntimeConfig {
  const selected = devices.find((device) => device.id === config.defaultInputDeviceId);
  if (selected) return config;
  const systemDevice = devices.find((device) => device.kind === "system");
  const fallback = systemDevice ?? devices[0];
  return fallback ? { ...config, defaultInputDeviceId: fallback.id } : config;
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
  const [notice, setNotice] = useState("Runtime initializing");
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

  const {
    status: updateStatus,
    updateInfo,
    progress: updateProgress,
    error: updateError,
    downloadAndInstall,
    dismiss: dismissUpdate,
  } = useUpdateChecker();

  const visibleSegments = useMemo(() => visibleSubtitleSegments(segments), [segments]);
  const isRunning = sessionStatus === "running";

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("fontSize", String(config.fontSize));
  }, [config.fontSize]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void getDevices()
        .then((runtimeDevices) => {
          setDevices(runtimeDevices);
          setConfig((current) => preferAvailableDevice(current, runtimeDevices));
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function bootstrap() {
    try {
      const [runtimeConfig, runtimeDevices, runtimeGlossary, runtimeSessions] = await Promise.all([
        getConfig(),
        getDevices(),
        getGlossary(),
        getSessions(),
      ]);
      setConfig(preferAvailableDevice(normalizeConfig(runtimeConfig), runtimeDevices));
      setDevices(runtimeDevices);
      setGlossary(runtimeGlossary);
      setSessions(runtimeSessions);
      setNotice("Runtime ready");
    } catch (error) {
      setNotice(
        `Runtime initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async function handleStart() {
    const errors: string[] = [];
    const asrKey = config.asrApiKey || config.apiKey;
    const asrUrl = config.asrBaseUrl || config.baseUrl;
    if (!asrUrl) errors.push("ASR Base URL is required");
    if (!asrKey) errors.push("ASR API Key is required");
    if (!config.apiKey) errors.push("Translation API Key is required");
    if (!config.defaultInputDeviceId) errors.push("Select an audio input device");
    if (errors.length > 0) {
      setNotice(`Cannot start: ${errors.join("; ")}`);
      return;
    }

    try {
      const record = await startSession({
        inputDeviceId: config.defaultInputDeviceId,
        sourceLang: config.sourceLang,
        targetLang: config.targetLang,
        displayMode: config.displayMode,
        asrProvider: config.asrProvider,
        translationProvider: config.translationProvider,
      });
      setSegments([]);
      setErrorLog([]);
      setDiagnostics({ droppedCount: 0, lowEnergyDrops: 0 });
      setActiveSession(record);
      setNotice("Session started");
    } catch (error) {
      setNotice(`Start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleStop() {
    const result = await stopSession();
    if ("id" in result) {
      setActiveSession(result);
    }
    setSessions(await getSessions());
    setNotice("Session stopped and saved");
  }

  async function handleSaveConfig() {
    const saved = await saveConfig(config);
    setConfig(normalizeConfig(saved));
    setNotice("Configuration saved");
  }

  async function openFloatingWindow() {
    window.localStorage.setItem("fontSize", String(config.fontSize));
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
        title: "AI Subtitles",
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
    if (!newTerm.source.trim() || !newTerm.target.trim()) return;
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
      setTestResult({ kind: "asr", ok: true, message: `Connected: ${res.base_url}` });
    } catch (error) {
      setTestResult({
        kind: "asr",
        ok: false,
        message: error instanceof Error ? error.message : String(error),
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
        message: `Connected. Sample: ${res.sample}`,
      });
    } catch (error) {
      setTestResult({
        kind: "translation",
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(null);
    }
  }

  const tabTitle: Record<Tab, string> = {
    console: "Live interpretation",
    settings: "Runtime and AI settings",
    history: "Session history",
    glossary: "Glossary",
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">AI</span>
          <div>
            <strong>Interpretation Assistant</strong>
            <span>Real-time bilingual subtitles</span>
          </div>
        </div>
        <nav className="nav-list">
          <NavButton
            active={tab === "console"}
            icon={<Activity />}
            label="Console"
            onClick={() => setTab("console")}
          />
          <NavButton
            active={tab === "settings"}
            icon={<Settings />}
            label="Settings"
            onClick={() => setTab("settings")}
          />
          <NavButton
            active={tab === "history"}
            icon={<History />}
            label="History"
            onClick={() => setTab("history")}
          />
          <NavButton
            active={tab === "glossary"}
            icon={<BookOpen />}
            label="Glossary"
            onClick={() => setTab("glossary")}
          />
        </nav>
        <div className="runtime-card">
          <span
            className={`status-dot ${socketStatus === "connected" ? "connected" : socketStatus}`}
          />
          <div>
            <strong>{socketStatus === "connected" ? "Runtime online" : "Runtime offline"}</strong>
            <span>{notice}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <UpdateBanner
          status={updateStatus}
          updateInfo={updateInfo}
          progress={updateProgress}
          error={updateError}
          onUpdate={() => void downloadAndInstall()}
          onDismiss={dismissUpdate}
        />
        <header className="topbar">
          <div>
            <span className="eyebrow">EN TO ZH-CN</span>
            <h1>{tabTitle[tab]}</h1>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={() => void bootstrap()}
              title="Refresh runtime"
            >
              {socketStatus === "connected" ? <Wifi /> : <WifiOff />}
            </button>
            <button className="secondary-button" onClick={() => void openFloatingWindow()}>
              <ExternalLink />
              Floating subtitles
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
              fontSize={config.fontSize}
            />
            <div className="latest-panel">
              <span className="eyebrow">Latest stable</span>
              {visibleSegments.length > 0 ? (
                (() => {
                  const latest =
                    [...visibleSegments].reverse().find((s) => s.status !== "interim") ??
                    visibleSegments[visibleSegments.length - 1];
                  return (
                    <>
                      <p
                        className="latest-source"
                        style={{ fontSize: `${config.fontSize * 0.75}px` }}
                      >
                        {latest.sourceText}
                      </p>
                      <p
                        className="latest-translation"
                        style={{ fontSize: `${config.fontSize}px` }}
                      >
                        {latest.translatedText}
                      </p>
                    </>
                  );
                })()
              ) : (
                <p className="latest-placeholder">No stable subtitles yet.</p>
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
            onAdd={(event) => void addGlossaryTerm(event)}
            onToggle={(term) => void toggleGlossary(term)}
            onRemove={(id) => void removeGlossaryTerm(id)}
          />
        )}
      </main>
    </div>
  );
}
