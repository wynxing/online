import {
  Activity,
  BookOpen,
  ExternalLink,
  History,
  Monitor,
  Settings,
  Sun,
  Moon,
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
import { useTheme } from "./hooks/useTheme";
import { t, detectLang, LangProvider } from "./i18n";
import type { Lang } from "./i18n";
import logoUrl from "./assets/brand/logo.png";
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
  vadEnabled: true,
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
    return (
      <LangProvider value={detectLang()}>
        <FloatingSubtitles />
      </LangProvider>
    );
  }
  return <MainConsole />;
}

function MainConsole() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const langRef = useRef(lang);
  const [tab, setTab] = useState<Tab>("console");
  const [devices, setDevices] = useState<Device[]>([]);
  const [config, setConfig] = useState<RuntimeConfig>(defaultConfig);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [historySegments, setHistorySegments] = useState<SubtitleSegment[]>([]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>([]);
  const [newTerm, setNewTerm] = useState({ source: "", target: "", domain: "" });
  const [notice, setNotice] = useState(() => t("runtime.initializing", detectLang()));
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

  const { theme, cycleTheme } = useTheme();

  const visibleSegments = useMemo(() => visibleSubtitleSegments(segments), [segments]);
  const isRunning = sessionStatus === "running";

  function cycleLang() {
    setLang((prev) => {
      const next = prev === "zh" ? "en" : "zh";
      window.localStorage.setItem("lang", next);
      return next;
    });
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    window.localStorage.setItem("fontSize", String(config.fontSize));
  }, [config.fontSize]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

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
      setNotice(t("runtime.ready", langRef.current));
    } catch (error) {
      setNotice(
        `${t("runtime.initFailed", langRef.current)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async function handleStart() {
    const errors: string[] = [];
    const asrKey = config.asrApiKey || config.apiKey;
    const asrUrl = config.asrBaseUrl || config.baseUrl;
    if (!asrUrl) errors.push(t("validation.asrBaseUrlRequired", lang));
    if (!asrKey) errors.push(t("validation.asrApiKeyRequired", lang));
    if (!config.apiKey) errors.push(t("validation.translationApiKeyRequired", lang));
    if (!config.defaultInputDeviceId) errors.push(t("validation.selectInputDevice", lang));
    if (errors.length > 0) {
      setNotice(errors.join("; "));
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
      setNotice(t("session.started", lang));
    } catch (error) {
      setNotice(
        `${t("session.startFailed", lang)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async function handleStop() {
    const result = await stopSession();
    if ("id" in result) {
      setActiveSession(result);
    }
    setSessions(await getSessions());
    setNotice(t("session.stoppedAndSaved", lang));
  }

  async function handleSaveConfig() {
    const saved = await saveConfig(config);
    setConfig(normalizeConfig(saved));
    setNotice(t("settings.saved", lang));
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
        title: t("floating.windowTitle", lang),
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
      setTestResult({
        kind: "asr",
        ok: true,
        message: `${t("test.connected", lang)}: ${res.base_url}`,
      });
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
        message: `${t("test.connectedSample", lang)}: ${res.sample}`,
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
    console: t("tab.console", lang),
    settings: t("tab.settings", lang),
    history: t("tab.history", lang),
    glossary: t("tab.glossary", lang),
  };

  return (
    <LangProvider value={lang}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-logo" src={logoUrl} alt={t("brand.title", lang)} />
            <div>
              <strong>{t("brand.title", lang)}</strong>
              <span>{t("brand.subtitle", lang)}</span>
            </div>
          </div>
          <nav className="nav-list">
            <NavButton
              active={tab === "console"}
              icon={<Activity />}
              label={t("nav.console", lang)}
              onClick={() => setTab("console")}
            />
            <NavButton
              active={tab === "settings"}
              icon={<Settings />}
              label={t("nav.settings", lang)}
              onClick={() => setTab("settings")}
            />
            <NavButton
              active={tab === "history"}
              icon={<History />}
              label={t("nav.history", lang)}
              onClick={() => setTab("history")}
            />
            <NavButton
              active={tab === "glossary"}
              icon={<BookOpen />}
              label={t("nav.glossary", lang)}
              onClick={() => setTab("glossary")}
            />
          </nav>
          <div className="runtime-card">
            <span
              className={`status-dot ${socketStatus === "connected" ? "connected" : socketStatus}`}
            />
            <div>
              <strong>
                {socketStatus === "connected"
                  ? t("runtime.online", lang)
                  : t("runtime.offline", lang)}
              </strong>
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
              <span className="eyebrow">{t("brand.sourceToTarget", lang)}</span>
              <h1>{tabTitle[tab]}</h1>
            </div>
            <div className="topbar-actions">
              <button
                className="icon-button"
                onClick={cycleLang}
                title={lang === "zh" ? "EN" : "中文"}
                aria-label={lang === "zh" ? "Switch to English" : "切换到中文"}
              >
                {lang === "zh" ? "EN" : "中"}
              </button>
              <button
                className="icon-button"
                onClick={cycleTheme}
                title={t(`theme.${theme}`, lang)}
                aria-label={t(`theme.${theme}`, lang)}
              >
                {theme === "light" ? <Sun /> : theme === "dark" ? <Moon /> : <Monitor />}
              </button>
              <button
                className="icon-button"
                onClick={() => void bootstrap()}
                title={t("runtime.refresh", lang)}
              >
                {socketStatus === "connected" ? <Wifi /> : <WifiOff />}
              </button>
              <button className="secondary-button" onClick={() => void openFloatingWindow()}>
                <ExternalLink />
                {t("floating.openButton", lang)}
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
                <span className="eyebrow">{t("subtitle.latestStable", lang)}</span>
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
                  <p className="latest-placeholder">{t("subtitle.noStableSubtitles", lang)}</p>
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
    </LangProvider>
  );
}
