# 运行时 API

运行时 API 通过 Tauri 命令和事件暴露在桌面进程内部，没有 HTTP 基础 URL，也没有 WebSocket 端点。

## 命令

| 命令 | 返回值 |
| --- | --- |
| `health_check` | `{ status: "ok" }` |
| `list_devices` | `Device[]` |
| `get_config` | `RuntimeConfig`（API 密钥已脱敏） |
| `save_config` | `RuntimeConfig` |
| `start_session` | `SessionRecord` |
| `stop_session` | `SessionRecord \| { status: "idle" }` |
| `list_sessions` | `SessionRecord[]` |
| `get_segments` | `SubtitleSegment[]` |
| `list_glossary` | `GlossaryTerm[]` |
| `create_glossary` | `GlossaryTerm` |
| `update_glossary` | `GlossaryTerm` |
| `delete_glossary` | `{ deleted: true }` |
| `test_asr` | 连接测试结果 |
| `test_translation` | 连接测试结果（含示例） |

### RuntimeConfig 字段

主要配置字段（序列化为 camelCase）：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `baseUrl` | `string` | `https://api.openai.com/v1` | 翻译 API 基础 URL |
| `apiKey` | `string` | `""` | 翻译 API 密钥（IPC 传输时脱敏） |
| `asrBaseUrl` | `string` | `""` | ASR API 基础 URL（为空时回退到 `baseUrl`） |
| `asrApiKey` | `string` | `""` | ASR API 密钥（IPC 传输时脱敏） |
| `asrModel` | `string` | `whisper-1` | ASR 模型名称 |
| `asrLanguage` | `string` | `en` | 音频源语言 |
| `sourceLang` | `string` | `en` | 翻译源语言 |
| `targetLang` | `string` | `zh-CN` | 翻译目标语言 |
| `displayMode` | `Source \| Translated \| Bilingual` | `Bilingual` | 字幕显示模式 |
| `fontSize` | `number` | `24` | 字幕字号 |
| `glossaryEnabled` | `boolean` | `true` | 启用术语表替换 |
| `vadEnabled` | `boolean` | `true` | 启用语音活动检测 |
| `audioDenoiseEnabled` | `boolean` | `true` | 启用 RNN 音频降噪 |
| `audioPeakNormalizeEnabled` | `boolean` | `true` | 启用峰值归一化 |
| `audioResampleQuality` | `string` | `fast` | 重采样质量（`fast` 或 `high`） |
| `diagnosticsEnabled` | `boolean` | `true` | 显示诊断条 |

前端通过 `@tauri-apps/api/core` 调用：

```ts
const devices = await invoke<Device[]>("list_devices");
const record = await invoke<SessionRecord>("start_session", { request });
```

## 事件

| 事件 | 载荷 |
| --- | --- |
| `session:status` | `{ sessionId?, status, updatedAt }` |
| `subtitle:segment-created` | `SubtitleSegment` |
| `subtitle:segment-updated` | `SubtitleSegment` |
| `subtitle:segment-corrected` | `SubtitleSegment` |
| `pipeline:metrics` | `PipelineMetricsPayload` |
| `runtime:error` | `RuntimeErrorPayload` |

前端通过 `@tauri-apps/api/event` 监听：

```ts
const unlisten = await listen<SubtitleSegment>("subtitle:segment-updated", (event) => {
  mergeSegment(event.payload);
});
```
