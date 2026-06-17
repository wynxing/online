# Runtime API

The runtime API is exposed through Tauri commands and events inside the desktop process. There is no HTTP base URL and no WebSocket endpoint.

## Commands

| Command | Returns |
| --- | --- |
| `health_check` | `{ status: "ok" }` |
| `list_devices` | `Device[]` |
| `get_config` | `RuntimeConfig` (API keys redacted) |
| `save_config` | `RuntimeConfig` |
| `start_session` | `SessionRecord` |
| `stop_session` | `SessionRecord \| { status: "idle" }` |
| `list_sessions` | `SessionRecord[]` |
| `get_segments` | `SubtitleSegment[]` |
| `list_glossary` | `GlossaryTerm[]` |
| `create_glossary` | `GlossaryTerm` |
| `update_glossary` | `GlossaryTerm` |
| `delete_glossary` | `{ deleted: true }` |
| `test_asr` | connectivity result |
| `test_translation` | connectivity result with sample |

### RuntimeConfig Fields

Key configuration fields (serialized as camelCase):

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `baseUrl` | `string` | `https://api.openai.com/v1` | Translation API base URL |
| `apiKey` | `string` | `""` | Translation API key (redacted in IPC) |
| `asrBaseUrl` | `string` | `""` | ASR API base URL (falls back to `baseUrl`) |
| `asrApiKey` | `string` | `""` | ASR API key (redacted in IPC) |
| `asrModel` | `string` | `whisper-1` | ASR model name |
| `asrLanguage` | `string` | `en` | Source audio language |
| `sourceLang` | `string` | `en` | Source language for translation |
| `targetLang` | `string` | `zh-CN` | Target language for translation |
| `displayMode` | `Source \| Translated \| Bilingual` | `Bilingual` | Subtitle display mode |
| `fontSize` | `number` | `24` | Subtitle font size |
| `glossaryEnabled` | `boolean` | `true` | Enable glossary term replacement |
| `vadEnabled` | `boolean` | `true` | Enable voice activity detection |
| `audioDenoiseEnabled` | `boolean` | `true` | Enable RNN audio denoising |
| `audioPeakNormalizeEnabled` | `boolean` | `true` | Enable peak normalization |
| `audioResampleQuality` | `string` | `fast` | Resample quality (`fast` or `high`) |
| `diagnosticsEnabled` | `boolean` | `true` | Show diagnostics strip |

Frontend calls use `@tauri-apps/api/core`:

```ts
const devices = await invoke<Device[]>("list_devices");
const record = await invoke<SessionRecord>("start_session", { request });
```

## Events

| Event | Payload |
| --- | --- |
| `session:status` | `{ sessionId?, status, updatedAt }` |
| `subtitle:segment-created` | `SubtitleSegment` |
| `subtitle:segment-updated` | `SubtitleSegment` |
| `subtitle:segment-corrected` | `SubtitleSegment` |
| `pipeline:metrics` | `PipelineMetricsPayload` |
| `runtime:error` | `RuntimeErrorPayload` |

Frontend listeners use `@tauri-apps/api/event`:

```ts
const unlisten = await listen<SubtitleSegment>("subtitle:segment-updated", (event) => {
  mergeSegment(event.payload);
});
```
