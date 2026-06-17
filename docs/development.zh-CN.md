# 开发指南

## 环境要求

| 工具 | 版本 |
| --- | --- |
| Node.js | 22+ |
| npm | 10+ |
| Rust | stable |

日常开发和打包不再需要 Python。

## 安装

```powershell
npm install
npm run tauri:dev
```

Rust 运行时内嵌在 Tauri 中，前端通过 Tauri 命令和事件与之通信。

仅前端模式：

```powershell
npm run desktop
```

## 常用检查

```powershell
npm run lint
npm run test
npm run desktop:build

cd apps\desktop\src-tauri
cargo check
cargo test
```

## 运行时模块

```text
apps/desktop/src-tauri/src/
├── commands/      # Tauri invoke 处理器
├── api/           # ASR 净化、ASR 客户端、翻译客户端
├── audio/         # 设备枚举与采集后端
├── pipeline/      # 采集、DSP、分段、ASR、幻觉过滤、翻译、事件发送
│   ├── mod.rs     # 主管道编排器
│   └── audio_dsp.rs  # 降噪、归一化、重采样
├── storage/       # SQLite 持久化
├── models.rs      # 与 TypeScript 共享的 Serde 模型
└── state.rs       # 应用状态
```

## 日志与数据

运行时数据默认存储在 `~/.online/` 下。

```text
~/.online/runtime.sqlite3
~/.online/logs/runtime.log
```

测试时可通过 `ONLINE_DATA_DIR` 自定义此路径。
