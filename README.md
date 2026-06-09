# AI 同声传译助手

[![CI](https://github.com/your-username/ai-simultaneous-interpretation-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/ai-simultaneous-interpretation-assistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/your-username/ai-simultaneous-interpretation-assistant)](https://github.com/your-username/ai-simultaneous-interpretation-assistant/releases)

实时双语字幕翻译桌面应用。捕获系统或麦克风音频，通过 ASR 识别英文语音，翻译为中文，并以字幕形式实时展示。

> 适用于英语演讲、技术分享、国际会议、网课等场景，降低语言门槛，提升信息获取效率。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [环境变量](#环境变量)
- [构建与发布](#构建与发布)
- [文档](#文档)
- [贡献](#贡献)
- [许可证](#许可证)

## 功能特性

- **实时语音识别** — 捕获系统音频或麦克风输入，通过 OpenAI 兼容 ASR 接口实时转写英文文本
- **智能翻译** — 基于 LLM 的上下文翻译，支持术语表约束注入，确保技术词汇翻译一致性
- **字幕修正** — `interim → final → corrected` 三阶段字幕流，自动修正识别或翻译错误
- **双语字幕** — 支持原文、译文、双语三种显示模式
- **悬浮字幕** — 独立置顶透明窗口，可拖动、可调字体，适合观看外部视频时使用
- **会话管理** — SQLite 持久化会话历史、字幕内容和术语表
- **自动更新** — 内置 Tauri 更新机制，支持静默检测和一键升级

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri v2 (Rust) |
| 前端 UI | React 18 + TypeScript + Vite |
| 后端 Runtime | Python 3.10+ · FastAPI · uvicorn |
| AI 服务 | OpenAI 兼容 API（Whisper ASR / Chat Completions 翻译） |
| 音频采集 | pyaudiowpatch (WASAPI) · sounddevice fallback |
| 数据存储 | SQLite (aiosqlite) |
| 打包分发 | PyInstaller (sidecar) · Tauri NSIS/MSI |
| 代码质量 | ESLint · Prettier · Ruff · Vitest · pytest · Husky |

## 快速开始

### 环境要求

- Node.js 22+
- Python 3.10+
- Rust (stable)
- Windows 10+（首要支持平台）

### 安装与运行

```powershell
# 1. 克隆仓库
git clone https://github.com/your-username/ai-simultaneous-interpretation-assistant.git
cd ai-simultaneous-interpretation-assistant

# 2. 安装前端依赖
npm install

# 3. 安装 Python Runtime 依赖
python -m pip install -r runtime\requirements.txt

# 4. 启动 Python Runtime（终端 1）
npm run runtime

# 5. 启动 Tauri 桌面应用（终端 2）
npm run tauri:dev
```

启动后，Python Runtime 默认监听 `http://127.0.0.1:8765`，前端通过 HTTP + WebSocket 与 Runtime 通信。

### 仅前端开发

如果只需开发前端 UI，可跳过 Tauri 壳，直接启动 Vite 开发服务器：

```powershell
npm run desktop
```

## 项目结构

```text
├── apps/desktop/              # Tauri + React 桌面应用
│   ├── src/                   # TypeScript 源码
│   │   ├── components/        #   React 组件
│   │   ├── hooks/             #   自定义 Hooks
│   │   ├── utils/             #   工具函数
│   │   └── test/              #   前端测试
│   └── src-tauri/             # Rust Tauri 后端
│       └── src/               #   Rust 源码（sidecar 管理）
├── runtime/                   # Python FastAPI Runtime
│   ├── app/                   # 应用代码
│   │   ├── pipeline/          #   实时字幕管线（ASR + 翻译）
│   │   ├── main.py            #   FastAPI 路由
│   │   ├── models.py          #   数据模型
│   │   └── storage.py         #   SQLite 存储层
│   └── tests/                 # Python 测试
├── scripts/                   # 构建与开发脚本
├── docs/                      # 项目文档
└── .github/                   # CI/CD 与 Issue 模板
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ONLINE_DATA_DIR` | `~/.online/` | 数据目录（数据库、配置、日志） |
| `ONLINE_RUNTIME_PORT` | `8765` | Runtime HTTP 端口 |

数据目录结构：

```text
~/.online/
├── runtime.sqlite3    # SQLite 数据库
├── config.json        # 运行时配置
└── logs/
    └── runtime.log    # 日志文件
```

## 构建与发布

### 本地构建

```powershell
# 构建 Python Runtime sidecar
npm run runtime:sidecar

# 完整本地 release 构建（含 sidecar + Tauri 安装包）
npm run release:local
```

### CI/CD 发布

推送 `v*` tag 自动触发 GitHub Actions，构建 Windows x64 安装包并上传至 Releases：

```powershell
git tag v0.2.0
git push origin v0.2.0
```

## 文档

| 文档 | 说明 |
|------|------|
| [项目方案](docs/ai-simultaneous-interpretation-plan.md) | 完整的系统设计文档 |
| [架构设计](docs/architecture.md) | 系统架构与数据流 |
| [API 参考](docs/api.md) | HTTP / WebSocket 接口文档 |
| [开发指南](docs/development.md) | 本地开发环境搭建与调试 |
| [构建部署](docs/deployment.md) | 打包、CI/CD 与发布流程 |
| [贡献指南](CONTRIBUTING.md) | 代码规范、提交约定与 PR 流程 |
| [更新日志](CHANGELOG.md) | 版本变更记录 |

## 贡献

欢迎提交 Issue 和 Pull Request！请先阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

[MIT License](LICENSE) © 2026 AI Interpretation Team
