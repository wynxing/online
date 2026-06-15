# Runtime API

The runtime API is exposed through Tauri commands and events inside the desktop process. There is no HTTP base URL and no WebSocket endpoint.

## Commands

| Command | Returns |
| --- | --- |
| `health_check` | `{ status: "ok" }` |
| `list_devices` | `Device[]` |
| `get_config` | `RuntimeConfig` |
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
