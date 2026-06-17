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
    ├── 管道 (pipeline)
    │   ├── 音频 DSP（降噪、归一化、重采样）
    │   ├── 分段器（VAD）
    │   ├── ASR 工作器
    │   ├── 幻觉过滤器
    │   ├── 翻译工作器
    │   └── Tauri 事件发射器
    ├── ASR 客户端（净化器 + Whisper）
    ├── 翻译客户端（术语表 + 缓存）
    └── SQLite 存储
```

运行时内嵌在 Tauri 进程中，应用不再启动 Python 进程、绑定本地 HTTP 端口或使用 WebSocket 传输。

## 音频采集

音频设备通过 Rust `audio` 模块的平台特定后端发现：

- Windows 使用原生 WASAPI。渲染端点暴露为 `wasapi_loopback_*` 系统音频源，捕获端点暴露为 `wasapi_mic_*` 麦克风源。
- macOS 和 Linux 使用 `cpal` 输入设备。BlackHole、Loopback、Soundflower、PulseAudio/PipeWire monitor 等虚拟音频设备归类为 `system`；其他输入归类为 `microphone`。
- 旧版 id（如 `system_loopback`、`default_microphone` 和空 id）会解析为当前最佳可用设备。

捕获的帧携带其原始采样率和通道数通过管道，分段不再假设 48 kHz 单声道音频。

## 音频 DSP

在进入 ASR 阶段之前，音频帧经过预处理链（`pipeline/audio_dsp.rs`）：

1. **降噪** — 基于 RNN 的噪声抑制（`nnnoiseless`）。在 48 kHz 单声道输入上运行；其他采样率跳过。跨帧保持状态以实现时序建模。
2. **单声道混音** — 多声道音频取平均值转为单声道。
3. **重采样** — 通过 `rubato` sinc 重采样器重采样至 16 kHz（ASR 目标）。
4. **峰值归一化** — 将安静音频放大或衰减削波至目标峰值电平。

降噪和峰值归一化可通过 RuntimeConfig 中的 `audio_denoise_enabled` 和 `audio_peak_normalize_enabled` 分别配置。

## ASR 幻觉检测

Whisper 模型可能产生幻觉输出（如重复上一次提示）。管道通过将新的 ASR 输出与最近的源文本进行比较来检测此问题：

- 大小写/空格归一化后**完全匹配** → 作为幻觉丢弃。
- **子串包含**且长度比高（>0.8） → 作为幻觉丢弃。
- 连续幻觉计数被跟踪；指标仍会更新以保持 UI 响应。

已知的 Whisper 噪音短语（如 "thank you for watching"、"subscribe"）在到达翻译之前会被 ASR 客户端的净化器拒绝。

## 数据流

```text
音频采集 -> DSP（降噪/归一化/重采样） -> 分段器（VAD） -> ASR -> 幻觉过滤 -> 翻译 -> 存储 -> Tauri 事件 -> React UI
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
