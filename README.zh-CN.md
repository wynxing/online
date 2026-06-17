<div align="center">

<img src="docs/assets/logo.png" alt="AI 同传助手" width="120" />

# AI 同传助手

**桌面端实时双语同声传译。**

[![CI](https://github.com/wynxing/online/actions/workflows/ci.yml/badge.svg)](https://github.com/wynxing/online/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/wynxing/online?include_prereleases&label=release)](https://github.com/wynxing/online/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#%EF%B8%8F-支持平台)
[![Tauri](https://img.shields.io/badge/built%20with-Tauri%20v2-FFC131)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/rust-stable-orange?logo=rust)](https://www.rust-lang.org/)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

捕获本地音频，通过兼容 OpenAI 的 ASR + 翻译服务，实时渲染双语字幕到主窗口或悬浮覆盖层。基于 Tauri v2 与内嵌 Rust 构建——无 Python sidecar、无 HTTP 端口、无 WebSocket 服务。

## 📸 应用预览

<p align="center">
  <img src="docs/assets/screenshot-main.png" alt="AI 同传助手主界面" width="800" />
</p>

## ✨ 核心特性

- 🎙️ **系统音频环回采集** — Windows 原生 WASAPI、macOS/Linux 使用 `cpal`
- 🧠 **音频 DSP 预处理** — RNN 降噪（`nnnoiseless`）、峰值归一化、sinc 重采样
- 🗣️ **兼容 OpenAI 的 ASR** — 支持 Whisper API 与带 `input_audio` 的 Chat Completions
- 🌐 **术语感知翻译** — 语言对作为 LRU 缓存键，术语字面替换
- 🔍 **VAD 智能分段** — 基于 `earshot` 的语音活动检测，可配置阈值
- 🛡️ **幻觉过滤** — 丢弃 Whisper 重复提示词幻觉与已知噪声输出
- 📺 **悬浮字幕** — 始终置顶，支持双语 / 仅原文 / 仅译文模式
- 💾 **本地优先存储** — SQLite（WAL 模式）保存会话、字幕、术语、配置
- 🌗 **双语界面** — 中文 / English，暖色调暗黑/明亮主题
- 🔄 **自动更新** — Tauri updater 插件 + 签名包

## 🚀 快速开始

### 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | 22+ |
| npm | 10+ |
| Rust | stable（含对应平台 target 工具链） |

### 安装与运行

```powershell
git clone https://github.com/wynxing/online.git
cd online
npm install
npm run tauri:dev
```

仅前端迭代（快速热重载，无 Rust 重编译）：

```powershell
npm run desktop
```

## 🖥️ 支持平台

| 平台 | 音频后端 | 状态 |
| --- | --- | --- |
| Windows 10 / 11 (x64) | WASAPI 环回（原生） | ✅ 主要平台 |
| macOS (x64 / arm64) | cpal + 虚拟设备（BlackHole、Loopback） | ✅ 支持 |
| Linux (x64) | cpal + PulseAudio / PipeWire monitor | ✅ 支持 |

## 📖 文档

- [架构设计](docs/architecture.zh-CN.md) — 运行时布局、管道、音频 DSP、幻觉检测
- [运行时 API](docs/api.zh-CN.md) — Tauri 命令、事件、`RuntimeConfig` 字段参考
- [开发指南](docs/development.zh-CN.md) — 环境配置、模块地图、日志与数据
- [部署](docs/deployment.zh-CN.md) — 本地发布构建、CI 发布流程、更新清单
- [更新日志](CHANGELOG.md) — 版本历史
- [贡献指南](CONTRIBUTING.md) — 提交规范、PR 流程、代码风格

## 🏗️ 架构概览

```text
音频采集 → DSP（降噪 · 归一化 · 重采样） → 分段器（VAD）
       → ASR → 幻觉过滤 → 翻译 → SQLite
       → Tauri 事件 → React UI（主窗口 + 悬浮窗）
```

详细架构图与说明见 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)。

## 🛠️ 开发

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run tauri:dev` | 启动完整桌面应用（前端 + Rust 运行时） |
| `npm run desktop` | 仅前端 Vite 开发服务器 |
| `npm run lint` | ESLint 检查 TypeScript |
| `npm run test` | Vitest 前端测试 |
| `npm run desktop:build` | 前端生产构建 |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` | Rust 测试（74 项） |
| `npm run release:local` | 本地发布打包 |

### 项目结构

```text
apps/desktop/
├── src/                    # React UI（TypeScript + Vite）
│   ├── components/         # ControlPanel、SettingsPanel、SubtitlePanel、FloatingSubtitles 等
│   ├── hooks/              # useSubtitleSocket、useTheme、useUpdateChecker
│   ├── i18n/               # en / zh 语言包
│   └── styles/             # 模块化 CSS（tokens、base、panels、animations）
└── src-tauri/
    └── src/
        ├── commands/       # Tauri invoke 处理器（14 个命令）
        ├── api/            # ASR 净化器 + 客户端、翻译客户端、重试
        ├── audio/          # WASAPI / cpal 设备发现与采集
        ├── pipeline/       # mod.rs（编排器）+ audio_dsp.rs（DSP）
        ├── storage/        # SQLite 持久化（rusqlite WAL 模式）
        ├── models.rs       # 与 TypeScript 共享的 Serde 模型
        └── state.rs        # AppState
docs/                       # 用户与开发者文档
scripts/                    # 构建、发布、版本号脚本
```

### 数据目录

运行时数据默认位于 `~/.online/`（可通过 `ONLINE_DATA_DIR` 覆盖）：

```text
~/.online/
├── runtime.sqlite3
└── logs/
    └── runtime.log
```

## 🤝 贡献

欢迎贡献代码！提交 PR 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

- Bug 反馈与功能请求：[GitHub Issues](https://github.com/wynxing/online/issues)
- 提交规范：[Conventional Commits](https://www.conventionalcommits.org/zh-hans/)
- Pre-commit 钩子（Husky + lint-staged）会自动执行 ESLint 与 Prettier。

## 📄 许可证

基于 [MIT License](LICENSE) 发布。版权所有 © 2026 AI Interpretation Team。

## 🙏 致谢

本项目构建于以下优秀开源项目之上：

- [Tauri](https://tauri.app/) — 桌面应用框架
- [nnnoiseless](https://github.com/jneem/nnnoiseless) — 基于 RNN 的噪声抑制
- [rubato](https://github.com/HEnquist/rubato) — 高质量音频重采样
- [earshot](https://crates.io/crates/earshot) — 语音活动检测
- [cpal](https://github.com/RustAudio/cpal) — 跨平台音频 I/O
- [rusqlite](https://github.com/rusqlite/rusqlite) — Rust SQLite 绑定
