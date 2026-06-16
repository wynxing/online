const en: Record<string, string> = {
  // Brand
  "brand.title": "AI Interpretation",
  "brand.subtitle": "Real-time Bilingual Subtitles",
  "brand.sourceToTarget": "EN → ZH-CN",

  // Nav
  "nav.console": "Console",
  "nav.settings": "Settings",
  "nav.history": "History",
  "nav.glossary": "Glossary",

  // Tabs
  "tab.console": "Live interpretation",
  "tab.settings": "Runtime and AI settings",
  "tab.history": "Session history",
  "tab.glossary": "Glossary management",

  // Runtime
  "runtime.online": "Runtime online",
  "runtime.offline": "Runtime offline",
  "runtime.initializing": "Runtime initializing",
  "runtime.initFailed": "Runtime initialization failed",
  "runtime.ready": "Runtime ready",
  "runtime.refresh": "Refresh runtime",

  // Session
  "session.started": "Session started",
  "session.stoppedAndSaved": "Session stopped and saved",
  "session.startFailed": "Start failed",

  // Validation
  "validation.asrBaseUrlRequired": "ASR Base URL is required",
  "validation.asrApiKeyRequired": "ASR API Key is required",
  "validation.translationApiKeyRequired": "Translation API Key is required",
  "validation.selectInputDevice": "Select an audio input device",

  // Settings
  "settings.saved": "Configuration saved",
  "settings.asrSection": "ASR",
  "settings.speechRecognition": "Speech recognition",
  "settings.apiFormat": "API format",
  "settings.asrFormatWhisper": "Standard ASR (/v1/audio/transcriptions)",
  "settings.asrFormatChat": "Chat Completions (/v1/chat/completions)",
  "settings.asrFormatWhisperHint":
    "Uploads audio as a file to a Whisper-compatible transcription endpoint.",
  "settings.asrFormatChatHint": "Sends base64 audio to a Chat Completions-compatible endpoint.",
  "settings.asrBaseUrl": "ASR Base URL",
  "settings.asrBaseUrlPlaceholder": "Leave blank to use translation Base URL",
  "settings.urlV1Hint": "The URL usually includes a /v1 suffix.",
  "settings.asrApiKey": "ASR API Key",
  "settings.asrApiKeyPlaceholder": "Leave blank to use translation API Key",
  "settings.asrModel": "ASR model",
  "settings.recognitionLanguage": "Recognition language",
  "settings.asrLanguagePlaceholder": "en / zh / auto",
  "settings.testAsr": "Test ASR connection",
  "settings.translationSection": "Translation",
  "settings.translationService": "Translation service",
  "settings.baseUrl": "Base URL",
  "settings.apiKey": "API Key",
  "settings.translationModel": "Translation model",
  "settings.sourceLanguage": "Source language",
  "settings.sourceLanguagePlaceholder": "en",
  "settings.targetLanguage": "Target language",
  "settings.targetLanguagePlaceholder": "zh-CN",
  "settings.testTranslation": "Test translation connection",
  "settings.performanceSection": "Performance",
  "settings.realtimePipeline": "Realtime pipeline",
  "settings.minSegmentSeconds": "Min segment seconds",
  "settings.maxSegmentSeconds": "Max segment seconds",
  "settings.silenceSplitSeconds": "Silence split seconds",
  "settings.vadEnabled": "Enable VAD voice endpoint detection",
  "settings.asrConcurrency": "ASR concurrency",
  "settings.translationConcurrency": "Translation concurrency",
  "settings.displaySection": "Display",
  "settings.subtitleDisplay": "Subtitle display",
  "settings.subtitleFontSize": "Subtitle font size",
  "settings.useGlossary": "Use glossary during translation",
  "settings.showDiagnostics": "Show realtime diagnostics",
  "settings.saveConfig": "Save configuration",
  "settings.subtitlePreview": "Subtitle Preview",
  "settings.previewSource": "We use caching to reduce latency.",
  "settings.previewTranslation": "Translation preview text",

  // Control panel
  "controlPanel.input": "Input",
  "controlPanel.audioSource": "Audio source",
  "controlPanel.captureSource": "Capture source",
  "controlPanel.noDevices": "No input devices found",
  "controlPanel.selectDeviceHint": "Select an input device for real-time capture.",
  "controlPanel.recognitionMode": "Recognition mode",
  "controlPanel.asrModeOpenAI": "OpenAI-compatible ASR",
  "controlPanel.start": "Start",
  "controlPanel.stop": "Stop",
  "controlPanel.clearSubtitles": "Clear subtitles",
  "controlPanel.defaultDevice": "Default device.",
  "controlPanel.mode.source": "Source",
  "controlPanel.mode.translated": "Translation",
  "controlPanel.mode.bilingual": "Bilingual",

  // Subtitle panel
  "subtitlePanel.liveStream": "Live Stream",
  "subtitlePanel.title": "Live subtitles",
  "subtitlePanel.session": "Session",
  "subtitlePanel.sessionNotStarted": "Not started",
  "subtitlePanel.status": "Status",
  "subtitlePanel.segmentCount": "Segments",
  "subtitlePanel.mode": "Mode",
  "subtitlePanel.modeMock": "Mock",
  "subtitlePanel.modeReal": "Real",
  "subtitlePanel.emptyTitle": "Waiting for stream",
  "subtitlePanel.emptyBody":
    "Start a session to see real-time recognition, translation, and correction events here.",
  "subtitle.latestStable": "Latest stable",
  "subtitle.noStableSubtitles": "No stable subtitles yet.",

  // Diagnostics
  "diagnostics.asr": "ASR",
  "diagnostics.translation": "Translation",
  "diagnostics.endToEnd": "End-to-end",
  "diagnostics.dropped": "Dropped",
  "diagnostics.queue": "Queue",
  "diagnostics.lowEnergy": "Low energy",
  "diagnostics.lastDropReason": "Last drop reason",

  // History
  "history.emptyTitle": "No history yet",
  "history.emptyBody": "After stopping a session, final subtitles are saved to SQLite.",
  "history.detailEmptyTitle": "Select a session",
  "history.detailEmptyBody": "Final and corrected subtitles from this session will appear here.",

  // Glossary
  "glossary.section": "Glossary",
  "glossary.addTerm": "Add term",
  "glossary.sourceTerm": "Source term",
  "glossary.targetTerm": "Target translation",
  "glossary.domain": "Domain",
  "glossary.addButton": "Add term",
  "glossary.domainGeneral": "General",
  "glossary.deleteTooltip": "Delete term",

  // Floating
  "floating.title": "AI Subtitles",
  "floating.close": "Close floating window",
  "floating.openButton": "Floating subtitles",
  "floating.waitingForSession": "Waiting for session to start...",
  "floating.windowTitle": "AI Subtitles",

  // Error boundary
  "errorBoundary.title": "Something went wrong",
  "errorBoundary.unknownError": "Unknown error",
  "errorBoundary.reload": "Reload",

  // Update
  "update.retry": "Retry",
  "update.updateNow": "Update now",
  "update.dismissTooltip": "Dismiss this update",
  "update.checkFailed": "Update check failed",
  "update.downloading": "Downloading",
  "update.installedRestarting": "Update installed, restarting...",
  "update.newVersion": "New version available",

  // Common
  "common.ok": "OK",
  "common.failed": "Failed",
  "common.testing": "Testing...",

  // Test
  "test.connected": "Connected",
  "test.connectedSample": "Connected. Sample",

  // Control panel extras
  "controlPanel.deviceId": "Device id",

  // Theme
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
};

export default en;
