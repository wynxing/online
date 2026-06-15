const zh: Record<string, string> = {
  // Brand
  "brand.title": "AI 同传助手",
  "brand.subtitle": "实时双语字幕",
  "brand.sourceToTarget": "EN → ZH-CN",

  // Nav
  "nav.console": "控制台",
  "nav.settings": "设置",
  "nav.history": "历史",
  "nav.glossary": "术语表",

  // Tabs
  "tab.console": "实时同传控制台",
  "tab.settings": "运行时与 AI 设置",
  "tab.history": "会话历史",
  "tab.glossary": "术语表管理",

  // Runtime
  "runtime.online": "运行时在线",
  "runtime.offline": "运行时离线",
  "runtime.initializing": "运行时初始化中",
  "runtime.initFailed": "运行时初始化失败",
  "runtime.ready": "运行时就绪",
  "runtime.refresh": "刷新运行时",

  // Session
  "session.started": "会话已启动",
  "session.stoppedAndSaved": "会话已停止并保存",
  "session.startFailed": "启动失败",

  // Validation
  "validation.asrBaseUrlRequired": "ASR 服务地址必填",
  "validation.asrApiKeyRequired": "ASR API Key 必填",
  "validation.translationApiKeyRequired": "翻译 API Key 必填",
  "validation.selectInputDevice": "请选择音频输入设备",

  // Settings
  "settings.saved": "配置已保存",
  "settings.asrSection": "ASR",
  "settings.speechRecognition": "语音识别",
  "settings.apiFormat": "API 格式",
  "settings.asrFormatWhisper": "标准 ASR (/v1/audio/transcriptions)",
  "settings.asrFormatChat": "Chat Completions (/v1/chat/completions)",
  "settings.asrFormatWhisperHint": "将音频作为文件上传到 Whisper 兼容的转写端点。",
  "settings.asrFormatChatHint": "将 base64 音频发送到 Chat Completions 兼容的端点。",
  "settings.asrBaseUrl": "ASR 服务地址",
  "settings.asrBaseUrlPlaceholder": "留空则使用翻译服务地址",
  "settings.urlV1Hint": "地址通常包含 /v1 后缀。",
  "settings.asrApiKey": "ASR API Key",
  "settings.asrApiKeyPlaceholder": "留空则使用翻译 API Key",
  "settings.asrModel": "ASR 模型",
  "settings.recognitionLanguage": "识别语言",
  "settings.asrLanguagePlaceholder": "en / zh / auto",
  "settings.testAsr": "测试 ASR 连接",
  "settings.translationSection": "翻译",
  "settings.translationService": "翻译服务",
  "settings.baseUrl": "服务地址",
  "settings.apiKey": "API Key",
  "settings.translationModel": "翻译模型",
  "settings.sourceLanguage": "源语言",
  "settings.sourceLanguagePlaceholder": "en",
  "settings.targetLanguage": "目标语言",
  "settings.targetLanguagePlaceholder": "zh-CN",
  "settings.testTranslation": "测试翻译连接",
  "settings.performanceSection": "性能",
  "settings.realtimePipeline": "实时管道",
  "settings.minSegmentSeconds": "最小分段秒数",
  "settings.maxSegmentSeconds": "最大分段秒数",
  "settings.silenceSplitSeconds": "静音分割秒数",
  "settings.asrConcurrency": "ASR 并发数",
  "settings.translationConcurrency": "翻译并发数",
  "settings.displaySection": "显示",
  "settings.subtitleDisplay": "字幕显示",
  "settings.subtitleFontSize": "字幕字号",
  "settings.useGlossary": "翻译时使用术语表",
  "settings.showDiagnostics": "显示实时诊断",
  "settings.saveConfig": "保存配置",
  "settings.subtitlePreview": "字幕预览",
  "settings.previewSource": "我们使用缓存来降低延迟。",
  "settings.previewTranslation": "翻译预览文本",

  // Control panel
  "controlPanel.input": "输入",
  "controlPanel.audioSource": "音频源",
  "controlPanel.captureSource": "采集源",
  "controlPanel.noDevices": "未找到输入设备",
  "controlPanel.selectDeviceHint": "选择一个输入设备用于实时采集。",
  "controlPanel.recognitionMode": "识别模式",
  "controlPanel.asrModeOpenAI": "OpenAI 兼容 ASR",
  "controlPanel.start": "开始",
  "controlPanel.stop": "停止",
  "controlPanel.clearSubtitles": "清除字幕",
  "controlPanel.defaultDevice": "默认设备。",
  "controlPanel.mode.source": "原文",
  "controlPanel.mode.translated": "译文",
  "controlPanel.mode.bilingual": "双语",

  // Subtitle panel
  "subtitlePanel.liveStream": "实时流",
  "subtitlePanel.title": "实时字幕",
  "subtitlePanel.session": "会话",
  "subtitlePanel.sessionNotStarted": "未启动",
  "subtitlePanel.status": "状态",
  "subtitlePanel.segmentCount": "段数",
  "subtitlePanel.mode": "模式",
  "subtitlePanel.modeMock": "Mock",
  "subtitlePanel.modeReal": "真实",
  "subtitlePanel.emptyTitle": "等待字幕流",
  "subtitlePanel.emptyBody": "启动会话后，这里会显示实时识别、翻译和修正事件。",
  "subtitle.latestStable": "最新稳定",
  "subtitle.noStableSubtitles": "暂无稳定字幕。",

  // Diagnostics
  "diagnostics.asr": "ASR",
  "diagnostics.translation": "翻译",
  "diagnostics.endToEnd": "端到端",
  "diagnostics.dropped": "丢弃",
  "diagnostics.queue": "队列",
  "diagnostics.lowEnergy": "低能量",
  "diagnostics.lastDropReason": "最近丢弃原因",

  // History
  "history.emptyTitle": "暂无历史记录",
  "history.emptyBody": "停止一次会话后，最终字幕会保存到 SQLite。",
  "history.detailEmptyTitle": "选择一条会话",
  "history.detailEmptyBody": "这里会展示该会话保存下来的最终字幕和修正字幕。",

  // Glossary
  "glossary.section": "术语表",
  "glossary.addTerm": "新增术语",
  "glossary.sourceTerm": "英文术语",
  "glossary.targetTerm": "中文译法",
  "glossary.domain": "领域",
  "glossary.addButton": "添加术语",
  "glossary.domainGeneral": "通用",
  "glossary.deleteTooltip": "删除术语",

  // Floating
  "floating.title": "AI 同传字幕",
  "floating.close": "关闭浮窗",
  "floating.openButton": "浮窗字幕",
  "floating.waitingForSession": "等待同传会话开始...",
  "floating.windowTitle": "AI 字幕",

  // Error boundary
  "errorBoundary.title": "应用遇到问题",
  "errorBoundary.unknownError": "未知错误",
  "errorBoundary.reload": "重新加载",

  // Update
  "update.retry": "重试",
  "update.updateNow": "立即更新",
  "update.dismissTooltip": "忽略此次更新",
  "update.checkFailed": "更新检查失败",
  "update.downloading": "正在下载",
  "update.installedRestarting": "更新已安装，正在重启...",
  "update.newVersion": "发现新版本",

  // Common
  "common.ok": "成功",
  "common.failed": "失败",
  "common.testing": "测试中...",

  // Test
  "test.connected": "已连接",
  "test.connectedSample": "已连接，示例",

  // Control panel extras
  "controlPanel.deviceId": "设备 ID",

  // Theme
  "theme.light": "浅色",
  "theme.dark": "深色",
  "theme.system": "跟随系统",
};

export default zh;
