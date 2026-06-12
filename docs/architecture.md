# 架构设计

本文档描述 AI 同声传译助手的系统架构、模块职责和数据流。

## 总体架构

系统采用桌面应用与本地 AI Runtime 分离的双进程架构：

```text
┌─────────────────────────────────────────┐
│              Tauri App (Rust)            │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │        React Frontend           │    │
│  │  主控制台 · 悬浮字幕 · 设置     │    │
│  │  术语表 · 历史记录               │    │
│  └──────────────┬──────────────────┘    │
│                 │                        │
│  Rust 后端      │  HTTP / WebSocket      │
│  sidecar 管理   │                        │
└─────────────────┼───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│        Python FastAPI Runtime            │
│                                         │
│  音频采集 → VAD/分段 → ASR → 翻译       │
│  字幕修正 · 术语表 · SQLite 存储        │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│              AI 服务                     │
│                                         │
│  Whisper ASR · LLM 翻译                 │
│  OpenAI 兼容接口                        │
└─────────────────────────────────────────┘
```

### 职责划分

| 组件 | 职责 |
|------|------|
| **Tauri App (Rust)** | 桌面窗口管理、Python sidecar 生命周期（启动/停止/重启）、窗口置顶与透明 |
| **React Frontend** | 用户交互、字幕展示、配置管理、术语表管理、会话历史浏览 |
| **Python Runtime** | 音频采集、VAD 分段、ASR 识别、LLM 翻译、字幕修正、数据持久化 |
| **AI 服务** | 外部 ASR 和翻译能力，通过 OpenAI 兼容 API 接入 |

### 通信协议

- **HTTP** — 控制类请求（设备列表、会话启停、配置读写、术语表 CRUD）
- **WebSocket** — 实时字幕事件推送（`segment.created` / `updated` / `corrected`）

## 实时字幕管线

字幕处理管线位于 `runtime/app/pipeline/`，采用异步任务编排：

```text
AudioCapture (线程)
      │ PCM frames
      ▼
SegmentProcessor
      │ 音频片段
      ▼
ASRWorker(s) ──────── 并发 N 个 worker
      │ recognized text
      ▼
TranslationWorker(s) ── 并发 M 个 worker
      │ translated text
      ▼
WebSocketBroadcaster
      │
      ▼
  Frontend
```

### 模块说明

| 模块 | 文件 | 职责 |
|------|------|------|
| AudioBackends | `audio_backends.py` | 按平台枚举/打开音频设备：Windows WASAPI、macOS/Linux PortAudio |
| AudioCapture | `audio_capture.py` | 跨平台采集 PCM 帧并入队 |
| SegmentProcessor | `pipeline/segment_processor.py` | 消费 PCM 帧，喂入 VAD 分段器，完成片段入队 |
| ASRWorker | `pipeline/asr_worker.py` | 消费音频片段，转 WAV，调用 ASR API，清洗文本，发送 `segment.created` |
| TranslationWorker | `pipeline/translation_worker.py` | 消费识别文本，流式翻译，句子连续性管理，发送 `segment.updated/corrected` |
| TextSanitizer | `pipeline/text_sanitize.py` | ASR 文本清洗：移除 think 块、角色前缀、Whisper 幻觉等 |
| SignalMonitor | `pipeline/signal_monitor.py` | 定期检测音频信号，无信号时发出警告 |
| Orchestrator | `pipeline/orchestrator.py` | 编排以上模块为并发 async 任务 |

### 并发模型

- ASR Worker 和 Translation Worker 均支持动态并发数
- Translation Worker 根据队列积压自动扩缩并发
- 队列满时采用 drop-oldest 策略，保证实时性
- 过期片段（stale）自动丢弃，避免延迟累积

## 字幕修正机制

字幕段使用 `id` + `version` 管理生命周期：

```text
interim → final → corrected
  v1        v2        v3
```

- `interim`：临时结果，可能变化
- `final`：当前片段已稳定
- `corrected`：基于后续上下文被修正

前端通过 `mergeSegment()` 按 `id` 定位、按 `version` 判断是否更新，修正段短暂高亮提示用户。

## 数据存储

SQLite 数据库存储于 `~/.online/runtime.sqlite3`：

| 表 | 内容 |
|----|------|
| `sessions` | 会话记录（开始/结束时间、语言对） |
| `segments` | 最终字幕段（原文、译文、时间戳） |
| `glossary` | 术语表（源词、目标词、领域、启用状态） |
| `config` | 运行时配置（JSON 序列化） |

## 进程生命周期

```text
应用启动
  │
  ├─ Tauri 初始化窗口
  ├─ Rust 启动 Python sidecar 进程
  ├─ Python Runtime 启动 uvicorn (127.0.0.1:8765)
  ├─ 前端连接 WebSocket
  │
  ├─ 用户操作 ...
  │
应用退出
  │
  ├─ Rust 终止 Python sidecar 进程
  └─ 清理资源
```

Sidecar 管理逻辑位于 `apps/desktop/src-tauri/src/lib.rs`：

- `runtime_status` 命令：检查 sidecar 存活状态
- `restart_runtime` 命令：终止并重启 sidecar
