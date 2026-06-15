# AI 同传助手

<p align="center">
  <img src="docs/assets/logo.png" alt="AI 同传助手 logo" width="160" />
</p>

实时双语字幕桌面应用。应用捕获本地音频，将音频片段发送至兼容 OpenAI 的 ASR 和翻译 API，并在主控制台或悬浮窗口中实时渲染字幕。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面运行时 | Tauri v2 + Rust |
| 运行时后端 | 内嵌 Rust 命令、事件、Tokio 管道 |
| UI | React 18 + TypeScript + Vite |
| 存储 | SQLite（通过 `rusqlite`） |
| AI 服务 | 兼容 OpenAI 的 ASR 和 Chat Completions |
| 打包 | Tauri bundles |

## 开发

```powershell
npm install
npm run tauri:dev
```

运行时内嵌在 Tauri 进程中，无需启动 Python 服务、sidecar 二进制、HTTP 端口或 WebSocket 服务器。

仅前端迭代：

```powershell
npm run desktop
```

## 数据

运行时数据默认存储在 `~/.online/` 下：

```text
~/.online/
├── runtime.sqlite3
└── logs/
    └── runtime.log
```

设置 `ONLINE_DATA_DIR` 可自定义数据目录。

## 构建与测试

```powershell
npm run lint
npm run test
npm run desktop:build
cd apps/desktop/src-tauri
cargo test
```

本地发布构建：

```powershell
npm run release:local
```

## 项目结构

```text
apps/desktop/
├── src/                 # React UI
└── src-tauri/
    ├── src/
    │   ├── commands/    # Tauri 命令接口
    │   ├── api/         # ASR 和翻译客户端
    │   ├── audio/       # 原生音频设备/采集
    │   ├── pipeline/    # 采集 -> ASR -> 翻译 -> 事件
    │   ├── storage/     # SQLite 持久化
    │   ├── models.rs
    │   └── state.rs
    └── tauri.conf.json
docs/
scripts/
```

## 说明

- 用户可见的 mock/演示模式已移除。
- 原有 Python 运行时文件不再参与开发、CI 或打包。
- 版本 `0.5.0` 起为 Rust 内嵌运行时发布线。
