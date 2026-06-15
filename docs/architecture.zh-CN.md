# 架构

## 概览

```text
桌面应用 (Tauri v2)
├── React UI
│   ├── invoke(command)
│   └── listen(event)
└── Rust 运行时
    ├── 命令 (commands)
    ├── 音频采集 (audio capture)
    ├── 分段管道 (segmentation pipeline)
    ├── ASR 客户端
    ├── 翻译客户端
    ├── SQLite 存储
    └── Tauri 事件发射器
```

运行时内嵌在 Tauri 进程中，应用不再启动 Python 进程、绑定本地 HTTP 端口或使用 WebSocket 传输。

## 数据流

```text
音频采集 -> 分段器 -> ASR -> 翻译 -> 存储 -> Tauri 事件 -> React UI
```

管道使用有界 Tokio 通道和取消令牌。`stop_session` 取消当前管道，等待任务结束，标记会话终止，并返回保存的会话记录。

## 存储

SQLite 文件位于 `~/.online/runtime.sqlite3`，可通过 `ONLINE_DATA_DIR` 覆盖。数据库存储运行时配置、会话、字幕片段和术语表。

## 前端契约

Rust 模型使用 camelCase 字段名序列化，确保与现有 TypeScript 契约保持一致：

- `RuntimeConfig`
- `Device`
- `SessionRecord`
- `SubtitleSegment`
- `GlossaryTerm`
