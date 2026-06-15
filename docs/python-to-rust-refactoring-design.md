# Python → Rust 重构设计文档

> 日期：2026-06-13
> 状态：已批准
> 版本：v0.4.13 → v0.5.0

## 1. 背景与动机

当前项目（AI 同声传译助手）采用 Python FastAPI 侧车架构：

- **Rust (Tauri v2)** 管理桌面窗口
- **Python (FastAPI)** 作为独立进程处理音频捕获、ASR、翻译、存储
- **React + TypeScript** 前端通过 HTTP/WebSocket 与 Python 通信

### 核心痛点

1. **打包地狱** — PyInstaller 跨平台构建不稳定，4 个 CI target 各需构建 Python 环境 + PyInstaller
2. **体积臃肿** — 侧车二进制 80MB+，整体安装包 100MB+
3. **双进程复杂度** — Rust 管理 Python 生命周期，进程崩溃重启、端口占用、进程树清理
4. **多语言维护成本** — Python + Rust + TypeScript 三栈，依赖管理、CI 环境各一套
5. **启动延迟** — 侧车进程启动需要数秒，前端需轮询等待后端就绪

### 重构目标

- 消除 Python 侧车，所有后端逻辑用 Rust 嵌入 Tauri
- 安装包体积降至 15-25MB
- 构建步骤从 3 步减至 1 步
- 单进程运行，无需端口通信
- 保持全部现有功能（除演示模式）

## 2. 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 后端运行时 | 纯 Rust，嵌入 Tauri | 去侧车，单进程，体积最小 |
| 音频捕获 | Rust + FFI/原生库桥接 | Windows WASAPI 原生实现，macOS/Linux 先用 cpal |
| 存储 | `rusqlite` + `spawn_blocking` | 最成熟稳定，SQLite 异步收益有限 |
| HTTP 客户端 | `reqwest` | 生态最主流，支持异步/multipart/流式 |
| 实时事件 | Tauri 事件系统 | 进程内通信，零网络开销，去掉 WebSocket |
| 并发管道 | Tokio Channel Pipeline | 与 Python asyncio 队列自然对应，背压可控 |
| 迁移策略 | 一次性重写（Big Bang） | 项目体量不大，避免新旧并存 |
| 前端策略 | 前后端同步重写 | 一步到位 |
| 演示模式 | 不保留 | 简化范围 |
| 旧数据迁移 | 不迁移 | 仅开发者自用，全新建表 |

## 3. 整体架构

### 架构对比

```
当前架构：
┌──────────────────────────────────────────────────────────┐
│ Desktop App (Tauri v2)                                   │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐ │
│  │ React UI     │  │ Rust Shell │  │ Python Sidecar   │ │
│  │              │──│ (管理侧车) │──│ (FastAPI :8765)  │ │
│  │ HTTP/WS ─────┼──┼────────────┼──│ ASR/翻译/音频    │ │
│  └──────────────┘  └────────────┘  └──────────────────┘ │
└──────────────────────────────────────────────────────────┘

重构后：
┌──────────────────────────────────────────────────────────┐
│ Desktop App (Tauri v2)                                   │
│  ┌──────────────┐     ┌───────────────────────────────┐  │
│  │ React UI     │     │ Rust Backend (Tauri Core)     │  │
│  │              │◄───►│ Pipeline / Storage / API       │  │
│  │ Tauri Cmd   │◄────│ Audio / Emitter                │  │
│  │ Tauri Events│     │ 全部嵌入同一进程               │  │
│  └──────────────┘     └───────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 关键变化

| 当前 | 重构后 |
|------|--------|
| Python FastAPI 侧车进程 | Rust 直接嵌入 Tauri |
| HTTP REST API | Tauri 命令 (`#[tauri::command]`) |
| WebSocket `/ws/subtitles` | Tauri 事件系统 (`app.emit()`) |
| `httpx` 异步 HTTP | `reqwest` 异步 HTTP |
| `aiosqlite` | `rusqlite` + `spawn_blocking` |
| `pyaudiowpatch` / `sounddevice` | `cpal` + 平台 FFI |
| PyInstaller 打包侧车 | 无需侧车，Tauri 直接构建 |
| 双进程（Rust 管理 Python） | 单进程 |

## 4. 模块划分

```
src-tauri/src/
├── main.rs              # Tauri 入口
├── lib.rs               # Tauri 插件注册、命令注册
├── commands/            # Tauri 命令（原 REST API）
│   ├── mod.rs
│   ├── session.rs       # 会话管理
│   ├── config.rs        # 配置读写
│   ├── devices.rs       # 设备列表
│   ├── glossary.rs      # 术语表 CRUD
│   └── health.rs        # 健康检查 + API 测试
├── pipeline/            # 实时字幕管道
│   ├── mod.rs
│   ├── orchestrator.rs  # 管道编排，管理 tokio tasks
│   ├── capture.rs       # 音频捕获（FFI 桥接）
│   ├── segmenter.rs     # 音频分段（VAD）
│   ├── asr_worker.rs    # ASR 并发 worker
│   ├── translation_worker.rs  # 翻译并发 worker
│   ├── emitter.rs       # Tauri 事件发射
│   └── types.rs         # 管道内部类型
├── audio/               # 音频后端
│   ├── mod.rs
│   ├── wasapi.rs        # Windows WASAPI (FFI)
│   ├── coreaudio.rs     # macOS CoreAudio (FFI)
│   └── pulseaudio.rs    # Linux PulseAudio
├── storage/             # 存储层
│   ├── mod.rs
│   ├── db.rs            # rusqlite 连接管理
│   ├── sessions.rs      # 会话存储
│   ├── segments.rs      # 字幕段存储
│   ├── glossary.rs      # 术语表存储
│   └── config.rs        # 配置存储
├── api/                 # 外部 API 客户端
│   ├── mod.rs
│   ├── asr.rs           # ASR API 客户端
│   └── translation.rs   # 翻译 API 客户端
├── models.rs            # 共享数据模型（Serde 序列化）
└── state.rs             # 应用状态管理（Mutex 管理 pipeline 等资源）
```

## 5. Pipeline 管道架构

### 数据流

```
AudioCapture ──[tx_audio]──► Segmenter ──[tx_segment]──► ASR Workers(N) ──[tx_asr]──► Translation Workers(M) ──[tx_trans]──► Emitter
  (tokio task)                (tokio task)                (N tasks)                       (M tasks)                       (tokio task)
                                                                                                                                 │
                                                                                                                        Tauri Event emit
                                                                                                                                 │
                                                                                                                         React Frontend
```

### Channel 定义与容量

| 通道 | 类型 | 容量 | 理由 |
|------|------|------|------|
| `audio_frames` | `mpsc::Sender<Vec<f32>>` | 64 | 音频帧高频（~20ms/帧），需要足够缓冲 |
| `segments` | `mpsc::Sender<AudioSegment>` | 16 | 分段后频率降低，中等缓冲 |
| `asr_results` | `mpsc::Sender<AsrResult>` | 32 | ASR 延迟不一，需要重排缓冲 |
| `translated` | `mpsc::Sender<TranslatedSegment>` | 32 | 翻译延迟不一，需要重排缓冲 |

所有通道均为有界通道，背压由容量限制自然控制。

### Orchestrator

```rust
pub struct PipelineOrchestrator {
    handle: Option<JoinHandle<()>>,
    cancel: CancellationToken,
}

impl PipelineOrchestrator {
    pub fn start(app: AppHandle, config: RuntimeConfig) -> Self {
        let cancel = CancellationToken::new();
        let token = cancel.clone();

        let handle = tokio::spawn(async move {
            let (audio_tx, audio_rx) = mpsc::channel(64);
            let (segment_tx, segment_rx) = mpsc::channel(16);
            let (asr_tx, asr_rx) = mpsc::channel(32);
            let (trans_tx, trans_rx) = mpsc::channel(32);

            let capture = tokio::spawn(audio_capture_task(audio_tx, token.clone()));
            let segmenter = tokio::spawn(segmenter_task(audio_rx, segment_tx, token.clone()));
            let asr = tokio::spawn(asr_worker_pool(segment_rx, asr_tx, &config, token.clone()));
            let translation = tokio::spawn(translation_worker_pool(asr_rx, trans_tx, &config, token.clone()));
            let emitter = tokio::spawn(emitter_task(trans_rx, app, token.clone()));

            let _ = tokio::try_join!(capture, segmenter, asr, translation, emitter);
        });

        Self { handle: Some(handle), cancel }
    }

    pub async fn stop(&mut self) {
        self.cancel.cancel();
        if let Some(h) = self.handle.take() {
            let _ = h.await;
        }
    }
}
```

### 优雅关闭

使用 `tokio_util::sync::CancellationToken`：

1. 调用 `cancel()` → 所有 task 收到取消信号
2. 各 task 在循环中检查 `token.is_cancelled()`，优雅退出
3. Drop sender 自动关闭下游 channel
4. `JoinHandle::await` 确保所有 task 完全结束

### Worker Pool

```rust
async fn asr_worker_pool(
    rx: SegmentRx,
    tx: AsrResultTx,
    config: &RuntimeConfig,
    token: CancellationToken,
) {
    let concurrency = config.asr_concurrency; // 默认 4
    let stream = ReceiverStream::new(rx);
    stream
        .map(|seg| async { asr_single(seg, config).await })
        .buffer_unordered(concurrency)
        .take_until(token.cancelled())
        .for_each(|result| async {
            let _ = tx.send(result).await;
        })
        .await;
}
```

- 使用 `futures::stream::BufferUnordered` 实现并发 worker
- 结果按完成顺序发出，下游通过 segment index 重排
- 取消时立即停止接收新任务

## 6. Tauri 命令与前端通信

### REST API → Tauri 命令映射

| 原 REST 端点 | Tauri 命令 | 说明 |
|----------------|-----------|------|
| `GET /api/health` | `health_check` | 健康检查 |
| `GET /api/devices` | `list_devices` | 音频设备列表 |
| `GET /api/config` | `get_config` | 获取配置 |
| `POST /api/config` | `save_config` | 保存配置 |
| `POST /api/session/start` | `start_session` | 开始会话 |
| `POST /api/session/stop` | `stop_session` | 停止会话 |
| `GET /api/sessions` | `list_sessions` | 历史会话列表 |
| `GET /api/sessions/:id/segments` | `get_segments` | 获取字幕段 |
| `GET/POST/PUT/DELETE /api/glossary` | `list/create/update/delete_glossary` | 术语表 CRUD |
| `POST /api/test-asr` | `test_asr` | 测试 ASR 连通性 |
| `POST /api/test-translation` | `test_translation` | 测试翻译连通性 |

### 命令实现模式

```rust
#[tauri::command]
async fn start_session(
    state: State<'_, AppState>,
    app: AppHandle,
    config: RuntimeConfig,
) -> Result<SessionInfo, String> {
    let mut pipeline = state.pipeline.lock().await;
    if pipeline.is_running() {
        return Err("Session already running".into());
    }
    let session_id = state.storage.create_session(&config).await
        .map_err(|e| e.to_string())?;
    pipeline.start(app, config);
    Ok(SessionInfo { id: session_id, started_at: Utc::now() })
}
```

### Tauri 事件定义

| 原 WebSocket 事件 | Tauri 事件名 | Payload 类型 |
|--------------------|-------------|-------------|
| `segment.created` | `subtitle:segment-created` | `SubtitleSegment` |
| `segment.updated` | `subtitle:segment-updated` | `SubtitleSegment` |
| `segment.corrected` | `subtitle:segment-corrected` | `SubtitleSegment` |
| `session.status` | `session:status` | `SessionStatus` |
| `pipeline.metrics` | `pipeline:metrics` | `PipelineMetrics` |
| `runtime.error` | `runtime:error` | `RuntimeError` |

### 事件发射

```rust
async fn emitter_task(
    mut rx: TranslationRx,
    app: AppHandle,
    token: CancellationToken,
) {
    while let Some(segment) = rx.recv().await {
        if token.is_cancelled() { break; }
        let _ = app.emit("subtitle:segment-created", &segment);
        let _ = app.emit("pipeline:metrics", &current_metrics());
    }
}
```

### 前端适配

**当前 → 重构后：**

```typescript
// 当前: HTTP 调用
const res = await fetch('http://localhost:8765/api/devices');
// 重构后: Tauri 命令
const devices = await invoke<AudioDevice[]>('list_devices');

// 当前: WebSocket
const ws = new WebSocket('ws://localhost:8765/ws/subtitles');
// 重构后: Tauri 事件
const unlisten = await listen<SubtitleSegment>('subtitle:segment-created', (e) => { ... });
```

### 前端改动范围

| 文件 | 改动 |
|------|------|
| `api.ts` | 全部重写：`fetch` → `invoke`，去掉 base URL |
| `hooks/useSubtitleSocket.ts` | 重写为 `useSubtitleEvents.ts`：WebSocket → `listen` |
| `types.ts` | 微调：字段命名随 Rust serde 变化 |
| `App.tsx` | 改启动逻辑：去掉等待后端就绪的轮询，Tauri 启动即可用 |
| `components/ControlPanel.tsx` | 设备列表、启动/停止调用方式变更 |
| `components/SettingsPanel.tsx` | 配置保存调用方式变更 |
| `components/HistoryPanel.tsx` | 历史查询调用方式变更 |
| `components/GlossaryPanel.tsx` | 术语表 CRUD 调用方式变更 |
| `components/DiagnosticsStrip.tsx` | 指标数据来源：WebSocket → Tauri 事件 |
| `components/FloatingSubtitles.tsx` | 字幕数据来源：WebSocket → Tauri 事件 |
| `vite.config.ts` | 去掉 API proxy 配置 |

## 7. 音频捕获桥接

### 架构

```
┌─────────────────────────────────────────────┐
│              capture.rs (统一接口)            │
│                                              │
│  pub trait AudioCaptureBackend {             │
│      fn list_devices() -> Vec<AudioDevice>;  │
│      fn start_capture(device_id, tx) -> JoinHandle; │
│      fn stop_capture(handle);                │
│  }                                           │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ wasapi.rs│  │coreaudio │  │pulseaudio │  │
│  │ (Windows)│  │  (macOS) │  │  (Linux)  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────┘
```

### 各平台实现策略

**Windows — WASAPI（优先级最高，主要用户群）**

```rust
use windows::Win32::Media::Audio::*;

pub struct WasapiCapture {
    device: IMMDevice,
    audio_client: IAudioClient,
}

impl AudioCaptureBackend for WasapiCapture {
    fn list_devices() -> Vec<AudioDevice> {
        // 枚举 IMMDeviceCollection
        // 区分输入设备(麦克风)和输出设备(系统音频loopback)
    }

    fn start_capture(&self, device_id: &str, tx: AudioFrameTx) -> JoinHandle<()> {
        // 初始化 IAudioClient + IAudioCaptureClient
        // 循环读取 buffer，转 f32，send 到 tx
    }
}
```

- 依赖：`windows` crate（Microsoft 官方 Rust 绑定）
- 支持 WASAPI Loopback 捕获系统音频（当前 `pyaudiowpatch` 的核心功能）
- COM 初始化在 capture task 中完成，避免跨线程 COM 问题

**macOS — CoreAudio**

- 依赖：`coreaudio-rs` crate 或直接 `objc2` FFI
- 第一版先用 `cpal` 做基础捕获，后续迭代替换为原生 CoreAudio

**Linux — PulseAudio**

- 依赖：`libpulse-binding` crate 或 `cpal`（ALSA 后端）
- 第一版先用 `cpal`，后续迭代替换

### 第一版务实策略

| 平台 | 第一版 | 后续迭代 |
|------|--------|---------|
| Windows | `windows-rs` FFI，原生 WASAPI Loopback | 优化 buffer 管理 |
| macOS | `cpal`（PortAudio 后端） | 原生 CoreAudio |
| Linux | `cpal`（ALSA 后端） | 原生 PulseAudio |

`cpal` 不支持 WASAPI Loopback，所以 Windows 必须原生实现。macOS/Linux 上 `cpal` 能覆盖麦克风捕获，第一版可用。

### 音频格式

统一为 `Vec<f32>`，32-bit float。如需重采样，使用 `rubato` crate。

### Cargo 依赖

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Media_Audio",
    "Win32_System_Com",
    "Win32_Foundation",
] }

[target.'cfg(not(windows))'.dependencies]
cpal = "0.22"
```

## 8. 存储层

### 架构

```rust
pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    pub fn new(data_dir: &Path) -> Result<Self> {
        let db_path = data_dir.join("runtime.sqlite3");
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(MIGRATIONS)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub async fn create_session(&self, config: &RuntimeConfig) -> Result<String> {
        let conn = self.conn.clone();
        let config = config.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().unwrap();
            conn.execute(
                "INSERT INTO sessions (id, started_at, config) VALUES (?1, ?2, ?3)",
                params![uuid, now, serde_json::to_string(&config)?],
            )?;
            Ok(uuid)
        }).await?
    }
}
```

### 关键决策

- **单连接 + Mutex** — SQLite 写入串行，WAL 模式读可并发，无需连接池
- **`spawn_blocking`** — rusqlite 同步 IO 不阻塞 tokio 运行时
- **不迁移旧数据** — 全新建表，`~/.online/runtime.sqlite3` 重建
- **配置存储** — 统一到 SQLite `config` 表，不再用 `config.json`

### 数据库 Schema

```sql
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    started_at  TEXT NOT NULL,
    stopped_at  TEXT,
    config      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id),
    index       INTEGER NOT NULL,
    original    TEXT NOT NULL,
    translated  TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    target      TEXT NOT NULL,
    note        TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id);
```

### 数据目录

`~/.online/` 保持不变：
- `runtime.sqlite3` — 数据库（全新创建）
- `logs/` — 日志文件（改用 `tracing` crate）

## 9. API 客户端

### ASR 客户端

根据 URL 自动选择 Whisper API 或 Chat Completions 模式：

```rust
pub struct AsrClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
    language: Option<String>,
}

impl AsrClient {
    pub async fn transcribe(&self, audio: &[f32], sample_rate: u32) -> Result<String> {
        if self.is_whisper_url() {
            self.transcribe_whisper(audio, sample_rate).await
        } else {
            self.transcribe_chat(audio, sample_rate).await
        }
    }

    async fn transcribe_whisper(&self, audio: &[f32], sample_rate: u32) -> Result<String> {
        let wav_data = encode_wav(audio, sample_rate);
        let form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .text("language", self.language.clone().unwrap_or_default())
            .part("file", reqwest::multipart::Part::bytes(wav_data)
                .file_name("audio.wav")
                .mime_str("audio/wav")?);
        let resp = self.http.post(format!("{}/audio/transcriptions", self.base_url))
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send().await?;
        Ok(resp.json::<WhisperResponse>().await?.text)
    }

    async fn transcribe_chat(&self, audio: &[f32], sample_rate: u32) -> Result<String> {
        let base64_audio = encode_base64_wav(audio, sample_rate);
        let body = serde_json::json!({
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": [
                    { "type": "text", "text": "Transcribe the following audio" },
                    { "type": "input_audio", "input_audio": {
                        "data": base64_audio,
                        "format": "wav"
                    }}
                ]
            }]
        });
        let resp = self.http.post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send().await?;
        Ok(resp.json::<ChatResponse>().await?.choices[0].message.content.clone())
    }
}
```

### 翻译客户端

```rust
pub struct TranslationClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
    glossary: Vec<GlossaryTerm>,
    context_window: usize,
    cache: LruCache<String, String>,
}

impl TranslationClient {
    pub async fn translate(&mut self, text: &str, context: &[String]) -> Result<String> {
        if let Some(cached) = self.cache.get(text) {
            return Ok(cached.clone());
        }

        let system_prompt = self.build_system_prompt();
        let mut messages = vec![serde_json::json!({
            "role": "system", "content": system_prompt
        })];
        for prev in context.iter().rev().take(self.context_window) {
            messages.push(serde_json::json!({ "role": "assistant", "content": prev }));
        }
        messages.push(serde_json::json!({ "role": "user", "content": text }));

        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
        });

        let resp = self.http.post(format!("{}/chat/completions", self.base_url))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send().await?;

        let translated = resp.json::<ChatResponse>().await?
            .choices[0].message.content.clone();
        self.cache.put(text.to_string(), translated.clone());
        Ok(translated)
    }

    fn build_system_prompt(&self) -> String {
        let mut prompt = "You are a professional translator. Translate English to Chinese.".to_string();
        if !self.glossary.is_empty() {
            prompt.push_str("\n\nGlossary:\n");
            for term in &self.glossary {
                prompt.push_str(&format!("- {} → {}\n", term.source, term.target));
            }
        }
        prompt
    }
}
```

### 音频编码

```rust
pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    // WAV header (44 bytes) + PCM 16-bit LE data
    // f32 → i16 截断
}
```

### 错误类型

```rust
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API returned error: {status} {message}")]
    Api { status: u16, message: String },
    #[error("Rate limited, retry after {0}s")]
    RateLimited(u64),
    #[error("Timeout")]
    Timeout,
}
```

## 10. 构建与打包

### 构建流程对比

**当前（3 步）：**
1. PyInstaller 打包 Python → 侧车二进制（~80MB+，4 个 target）
2. 复制侧车到 `src-tauri/binaries/`
3. Tauri 构建 → 打包侧车 + 前端 + Rust shell → 安装包

**重构后（1 步）：**
1. Tauri 构建 → `cargo build` + `vite build` → 安装包

### 收益对比

| 指标 | 当前 | 重构后 |
|------|------|--------|
| 构建步骤 | 3 步 | 1 步 |
| 安装包体积 | ~100MB+ | ~15-25MB（预估） |
| CI 构建时间 | 长（Python env + PyInstaller + Tauri） | 短（仅 Rust + Node） |
| 跨平台问题 | Python + PyInstaller 不稳定 | Rust 交叉编译成熟 |
| 侧车管理 | 需要手动复制+命名 | 无需侧车 |

### CI/CD 变化

**当前 release.yml 步骤：**
1. 设置 Python 环境
2. 安装 Python 依赖
3. PyInstaller 构建侧车
4. 复制侧车到 binaries/
5. 设置 Node.js 环境
6. 安装前端依赖
7. Tauri 构建
8. 生成更新清单
9. 发布

**重构后：**
1. 设置 Node.js 环境
2. 安装前端依赖
3. Tauri 构建（cargo build 自动编译 Rust 后端）
4. 生成更新清单
5. 发布

CI 步骤减少约 40%，不需要 Python 环境。

### tauri.conf.json 变化

- 删除 `"externalBin": ["binaries/ai-interpretation-runtime"]`
- CSP 策略简化：去掉 `ws://127.0.0.1:8765` 和 `http://127.0.0.1:8765`
- 不再需要 sidecar 权限

### 删除的文件/目录

| 路径 | 原因 |
|------|------|
| `runtime/` | 整个 Python 后端目录 |
| `scripts/build-runtime-sidecar.mjs` | 侧车构建脚本 |
| `apps/desktop/src-tauri/binaries/` | 侧车二进制存放 |
| `runtime/ai-interpretation-runtime.spec` | PyInstaller 配置 |

## 11. 测试策略

### 测试分层

| 层级 | 工具 | 范围 |
|------|------|------|
| 单元测试 | Rust `#[test]` | segmenter, asr_client, storage, wav_encode |
| 集成测试 | Rust `#[tokio::test]` | Pipeline: capture → ASR → emit; Storage: 写入 → 读取 |
| 前端测试 | Vitest | api 适配层, 组件渲染, 事件处理 |
| E2E 测试 | Tauri 测试工具 | 启动应用 → 开始会话 → 收到字幕 |

### Rust 单元测试

每个模块内 `#[cfg(test)] mod tests`，使用内存 SQLite 数据库：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Storage {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(MIGRATIONS).unwrap();
        Storage { conn: Mutex::new(conn) }
    }

    #[test]
    fn create_and_list_sessions() {
        let storage = test_db();
        let id = storage.create_session_sync(&test_config());
        assert!(id.is_ok());
        let sessions = storage.list_sessions_sync();
        assert_eq!(sessions.unwrap().len(), 1);
    }
}
```

### Pipeline 集成测试

用 mock 替换真实 API 调用，验证端到端数据流：

```rust
#[tokio::test]
async fn pipeline_produces_subtitle_events() {
    let app = mock_app_handle();
    let config = RuntimeConfig { asr_url: "http://mock-asr".into(), .. };
    let pipeline = PipelineOrchestrator::start_with_mocks(app, config, mock_asr, mock_translation);

    // 发送测试音频帧
    // 验证收到 Tauri 事件
    // 停止管道
    pipeline.stop().await;
}
```

### 前端测试

```typescript
import { invoke } from '@tauri-apps/api/core';
import { listDevices } from '../api';

vi.mock('@tauri-apps/api/core');

test('listDevices calls invoke with correct command', async () => {
  const mockDevices = [{ id: '1', name: 'Mic' }];
  vi.mocked(invoke).mockResolvedValue(mockDevices);
  const devices = await listDevices();
  expect(invoke).toHaveBeenCalledWith('list_devices');
  expect(devices).toEqual(mockDevices);
});
```

## 12. 错误处理

### 全局原则

用 `thiserror` 定义错误类型，`Result<T, E>` 传播，不在内部吞错误。

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Storage error: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("API error: {0}")]
    Api(#[from] ApiError),
    #[error("Audio error: {0}")]
    Audio(String),
    #[error("Pipeline error: {0}")]
    Pipeline(String),
    #[error("Config error: {0}")]
    Config(String),
}

impl From<AppError> for String {
    fn from(e: AppError) -> String {
        e.to_string()
    }
}
```

### Pipeline 内部错误传播

- ASR/翻译失败 → 记录错误，跳过该段，不中断管道
- 通过 `runtime:error` 事件通知前端
- 连续失败超过阈值 → 暂停管道，通知用户

```rust
match asr_client.transcribe(&segment.audio, segment.sample_rate).await {
    Ok(text) => { /* 发送到下游 */ },
    Err(e) => {
        tracing::warn!("ASR failed for segment {}: {}", segment.index, e);
        error_count.fetch_add(1, Ordering::Relaxed);
        app.emit("runtime:error", &RuntimeError {
            stage: "asr",
            message: e.to_string(),
        });
    }
}
```

### 日志

用 `tracing` 替代 Python 日志：

- 日志写入 `~/.online/logs/runtime.log`
- 使用 `tracing-appender` 的 non-blocking writer
- 前端可通过 Tauri 命令读取日志

## 13. Cargo 依赖汇总

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
tokio-util = { version = "0.7", features = ["rt"] }
rusqlite = { version = "0.32", features = ["bundled"] }
reqwest = { version = "0.12", features = ["json", "multipart"] }
thiserror = "2"
tracing = "0.1"
tracing-subscriber = "0.3"
tracing-appender = "0.2"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
lru = "0.12"
futures = "0.3"
hound = "3.5"
base64 = "0.22"
rubato = "0.15"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Media_Audio",
    "Win32_System_Com",
    "Win32_Foundation",
] }

[target.'cfg(not(windows))'.dependencies]
cpal = "0.22"
```
