# 运行时 API

运行时 API 通过 Tauri 命令和事件暴露在桌面进程内部，没有 HTTP 基础 URL，也没有 WebSocket 端点。

## 命令

| 命令 | 返回值 |
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
| `test_asr` | 连接测试结果 |
| `test_translation` | 连接测试结果（含示例） |

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
