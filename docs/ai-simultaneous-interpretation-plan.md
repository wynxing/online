# AI 同声传译助手项目方案

> ⚠️ **历史归档（2026-06-14 标注）**
>
> 本文档为 v0.5.0 之前 Python FastAPI sidecar 架构的设计方案，仅保留作为历史参考。
> v0.5.0 起，Runtime 已全面迁移为 Rust/Tauri 原生实现：
> - Python sidecar、FastAPI、WebSocket、PyInstaller 打包流程已全部移除
> - 当前后端为单进程 Rust 代码，前端通过 Tauri IPC（invoke/listen）通信
> - 详见 `CHANGELOG.md` v0.5.0 条目
>
> 本文中关于 Python 模块、`runtime/` 目录、HTTP 端口、PyInstaller 等内容均已不再适用。

## 1. 项目概述

AI 同声传译助手是一款面向外语音视频内容观看场景的桌面应用。用户在观看英语演讲、技术分享、国际会议、网课或其他外语内容时，可以通过本应用实时获取中文翻译字幕，从而降低语言门槛，提升信息获取效率。

项目第一版以“实时双语字幕”为核心能力。系统采集单向音频流，完成语音识别、中文翻译、字幕展示和历史字幕修正。字幕作为主要呈现形式；中文语音播报作为后续扩展能力。

## 2. 建设目标

第一版需要实现以下目标：

- 支持用户选择音频输入源并启动同传会话。
- 实时识别英语音频并生成英文原文字幕。
- 将英文字幕实时翻译为简洁自然的中文字幕。
- 在主窗口和悬浮字幕窗口中展示双语字幕。
- 自动修正之前识别或翻译错误的字幕段。
- 保存基础会话历史，方便用户回看字幕内容。
- 支持基础术语表，用于提升技术词汇翻译一致性。

核心体验指标：

- 字幕持续输出，适合用户跟随演讲、会议或课程节奏阅读。
- 从一句话结束到中文字幕出现，目标延迟为 2-4 秒。
- 字幕修正时只更新对应字幕段，不重复追加、不打乱顺序。

## 3. 功能范围

### 3.1 MVP 功能

- 音频输入：支持麦克风输入，并规划支持系统音频输入。
- 实时识别：将英文语音转换为英文字幕。
- 实时翻译：将英文字幕翻译为中文字幕。
- 双语字幕：支持原文、译文、双语三种显示模式。
- 悬浮字幕：提供置顶、透明、可拖动的字幕窗口。
- 自动修正：支持临时字幕、最终字幕、修正字幕的局部更新。
- 历史记录：保存会话信息和最终字幕内容。
- 术语表：支持添加、启用、禁用术语，并影响翻译结果。

### 3.2 后续扩展

- 系统音频采集增强。
- 中文语音播报。
- 多语言识别与翻译。
- 本地离线 ASR 模式。
- 更完整的历史检索、导出和摘要能力。
- 更多字幕样式和快捷键控制。

## 4. 总体架构

系统采用桌面应用与本地 AI Runtime 分离的架构：

```text
┌────────────────────────────────────┐
│              Tauri App              │
│                                    │
│  主控制台                           │
│  悬浮字幕窗口                       │
│  设置页                             │
│  术语表管理                         │
│  历史记录                           │
│  Python Runtime 启动管理            │
└────────────────┬───────────────────┘
                 │
                 │ HTTP / WebSocket
                 ↓
┌────────────────────────────────────┐
│        Python FastAPI Runtime       │
│                                    │
│  音频采集                           │
│  VAD 与音频分段                     │
│  ASR 语音识别                       │
│  LLM 翻译                           │
│  字幕修正                           │
│  SQLite 存储                        │
└────────────────┬───────────────────┘
                 │
                 ↓
┌────────────────────────────────────┐
│              AI 服务                │
│                                    │
│  流式 ASR                           │
│  LLM 翻译                           │
│  可选本地 ASR                       │
└────────────────────────────────────┘
```

职责划分：

- Tauri App 负责桌面窗口、用户交互、字幕展示、配置管理和 Runtime 生命周期管理。
- Python Runtime 负责音频处理、语音识别、翻译、字幕修正、历史记录和术语表处理。
- HTTP 用于控制类请求，WebSocket 用于实时字幕事件推送。

## 5. 核心处理流程

应用启动流程：

1. 用户打开桌面应用。
2. Tauri 启动 Python Runtime。
3. Python Runtime 开启本地服务。
4. 前端连接 WebSocket。
5. 用户选择输入设备并点击“开始同传”。
6. Python Runtime 开始采集音频并处理字幕。
7. 前端实时展示字幕结果。
8. 用户停止会话后，系统保存会话历史。

实时字幕处理流程：

```text
AudioCapture
  ↓
VAD / Segmenter
  ↓
ASRWorker
  ↓
TranslationWorker
  ↓
CorrectionManager
  ↓
WebSocketBroadcaster
```

模块说明：

- `AudioCapture`：采集麦克风或系统音频。
- `VAD / Segmenter`：检测人声并切分音频片段。
- `ASRWorker`：将音频片段转换为英文文本。
- `TranslationWorker`：将英文文本翻译为中文。
- `CorrectionManager`：管理字幕版本并生成修正事件。
- `WebSocketBroadcaster`：向前端推送字幕更新。

## 6. 字幕修正机制

系统使用版本化字幕段管理识别和翻译结果。

字幕状态：

- `interim`：临时字幕，表示当前结果仍可能变化。
- `final`：最终字幕，表示当前语音片段已稳定。
- `corrected`：修正字幕，表示该字幕段基于后续识别结果或上下文被更新。

修正规则：

- 每个字幕段拥有稳定的 `id`。
- 每次更新字幕段时递增 `version`。
- 前端根据 `id` 定位字幕段，根据 `version` 判断是否更新。
- `segment.corrected` 事件用于通知前端局部替换旧字幕。
- 被修正字幕段在界面中短暂高亮，提示用户内容已更新。

示例：

```text
临时字幕：
We use cashing to reduce latency.
我们使用现金来降低延迟。

修正字幕：
We use caching to reduce latency.
我们使用缓存来降低延迟。
```

## 7. 接口设计

### 7.1 HTTP 控制接口

```text
GET  /api/devices
POST /api/session/start
POST /api/session/stop
GET  /api/config
POST /api/config
```

接口说明：

- `GET /api/devices`：返回可用音频输入设备。
- `POST /api/session/start`：开始同传会话。
- `POST /api/session/stop`：停止当前同传会话。
- `GET /api/config`：读取当前配置。
- `POST /api/config`：更新当前配置。

`POST /api/session/start` 请求示例：

```json
{
  "inputDeviceId": "device_001",
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "displayMode": "bilingual",
  "asrProvider": "cloud",
  "translationProvider": "llm"
}
```

### 7.2 WebSocket 字幕接口

```text
GET /ws/subtitles
```

消息类型：

- `segment.created`
- `segment.updated`
- `segment.corrected`
- `session.status`
- `runtime.error`

字幕事件示例：

```json
{
  "type": "segment.updated",
  "payload": {
    "id": "seg_001",
    "sessionId": "session_001",
    "sourceText": "Today we are going to talk about edge computing.",
    "translatedText": "今天我们来聊边缘计算。",
    "status": "final",
    "version": 2,
    "startTime": 1.25,
    "endTime": 4.8,
    "updatedAt": "2026-06-04T20:00:00Z"
  }
}
```

错误事件示例：

```json
{
  "type": "runtime.error",
  "payload": {
    "code": "ASR_UNAVAILABLE",
    "message": "ASR service is unavailable.",
    "recoverable": true
  }
}
```

## 8. 数据结构

### 8.1 字幕段

```ts
export type SubtitleStatus = "interim" | "final" | "corrected";

export interface SubtitleSegment {
  id: string;
  sessionId: string;
  sourceText: string;
  translatedText: string;
  status: SubtitleStatus;
  version: number;
  startTime: number;
  endTime?: number;
  updatedAt: string;
}
```

### 8.2 会话记录

```ts
export interface SessionRecord {
  id: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  startedAt: string;
  endedAt?: string;
}
```

### 8.3 术语项

```ts
export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  domain?: string;
  enabled: boolean;
}
```

## 9. 页面设计

### 9.1 主控制台

主控制台用于管理会话、输入设备和字幕列表。

核心区域：

- 设备选择。
- 源语言与目标语言显示。
- 开始、停止、清空按钮。
- 当前连接状态。
- 实时双语字幕列表。
- 最近修正提示。

### 9.2 悬浮字幕窗口

悬浮字幕窗口用于用户观看外部视频或会议时持续显示字幕。

窗口能力：

- 置顶显示。
- 透明背景。
- 无边框。
- 可拖动。
- 可调整字体大小。
- 可切换原文、译文、双语模式。
- 修正字幕短暂高亮。

### 9.3 设置页

设置页用于管理应用行为。

配置项：

- 默认输入设备。
- 字幕显示模式。
- 字体大小。
- ASR 服务配置。
- 翻译服务配置。
- 术语表启用状态。

### 9.4 历史记录页

历史记录页用于查看已结束的同传会话。

功能：

- 查看会话列表。
- 查看会话字幕。
- 按时间排序。
- 导出字幕文本。

## 10. 技术选型

### 10.1 桌面端

- Tauri v2。
- React + Vite。
- TypeScript。
- Tailwind CSS 或普通 CSS。
- Rust 负责 Tauri command、窗口管理和 sidecar 进程管理。

### 10.2 Python Runtime

- Python 3.10+。
- FastAPI。
- WebSocket。
- SQLite。
- 音频采集模块。
- VAD 模块。
- ASR 模块。
- LLM 翻译模块。
- 字幕修正模块。

### 10.3 AI 能力

- ASR：第一版使用稳定的流式 ASR 服务。
- 翻译：使用 LLM API 进行上下文翻译。
- 术语表：翻译时注入启用的术语约束。
- 本地 ASR：作为扩展能力接入 `faster-whisper`。

### 10.4 打包方式

- Python Runtime 使用 PyInstaller 或 Nuitka 打包为可执行文件。
- Tauri 将 Python Runtime 作为 sidecar 一起分发。
- 应用启动时自动启动 Runtime，应用退出时关闭 Runtime。

## 11. 开发计划

### 阶段一：Python Runtime 原型

- 实现音频输入设备列表。
- 实现音频采集。
- 接入 ASR。
- 接入 LLM 翻译。
- 在命令行输出双语字幕。

### 阶段二：服务接口

- 实现 FastAPI 服务。
- 实现会话开始与停止接口。
- 实现设备列表接口。
- 实现 WebSocket 字幕推送。
- 实现基础错误事件。

### 阶段三：桌面主窗口

- 创建 Tauri 应用。
- 实现主控制台。
- 接入 HTTP 控制接口。
- 接入 WebSocket 字幕事件。
- 展示实时字幕列表。

### 阶段四：悬浮字幕窗口

- 创建独立字幕窗口。
- 实现置顶、透明、可拖动窗口。
- 实现双语字幕展示。
- 实现字幕修正高亮。

### 阶段五：历史记录与术语表

- 使用 SQLite 保存会话。
- 保存最终字幕段。
- 实现历史会话查看。
- 实现术语表管理。
- 翻译时应用术语表。

### 阶段六：打包与集成

- 打包 Python Runtime。
- 配置 Tauri sidecar。
- 实现应用启动时自动启动 Runtime。
- 实现应用退出时关闭 Runtime。
- 完成演示版本构建。

## 12. 测试与验收

### 12.1 音频输入

- 能列出可用输入设备。
- 能使用选定设备采集音频。
- 采集过程中开始、停止操作正常。

### 12.2 语音识别

- 播放英文演讲片段后，系统能持续输出英文字幕。
- 临时字幕和最终字幕状态正确。
- 字幕段顺序正确。

### 12.3 翻译

- 中文翻译自然、简洁。
- 技术术语翻译准确。
- 启用术语表后，术语翻译保持一致。

### 12.4 字幕修正

- 支持 `interim -> final -> corrected` 流程。
- 前端按字幕段局部更新。
- 修正事件不会重复追加字幕。
- 旧版本事件不会覆盖新版本内容。

### 12.5 界面

- 主窗口可正常开始、停止、清空会话。
- 悬浮字幕窗口可置顶、拖动和调整显示。
- 双语字幕在不同窗口尺寸下保持可读。

### 12.6 会话历史

- 停止会话后保存历史记录。
- 历史页面可查看会话字幕。
- 字幕导出内容完整。

## 13. 交付物

第一版交付物：

- Tauri 桌面应用。
- Python FastAPI Runtime。
- 实时字幕 WebSocket 服务。
- 主控制台页面。
- 悬浮字幕窗口。
- 基础历史记录。
- 基础术语表。
- 打包后的桌面演示版本。

## 14. 默认约定

- 第一版以字幕同传为主，不实现中文语音播报。
- 第一版优先保证英文到中文的同传体验。
- Windows 作为首要运行平台。
- Python Runtime 以后端本地服务形式运行。
- Tauri 通过 sidecar 管理 Python Runtime。
- 字幕修正通过稳定 `id` 和递增 `version` 实现。
