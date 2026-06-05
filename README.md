# AI 同声传译助手

一个可跑演示版桌面应用：Tauri v2 + React + TypeScript 前端，Python FastAPI Runtime 后端，本地 HTTP/WebSocket 通信。

## 当前能力

- 系统音频优先的设备列表，检测失败时降级为 mock 音频源。
- `interim -> final -> corrected` mock 字幕流，演示识别、翻译和自动修正。
- 主控制台实时展示双语字幕，并按 `id/version` 局部更新。
- 独立悬浮字幕窗口，支持原文、译文、双语切换。
- OpenAI 兼容格式配置预留：`baseUrl`、`apiKey`、`translationModel`。
- SQLite 保存会话历史、最终字幕和术语表。

## 运行

安装前端依赖：

```powershell
npm install
```

安装 Python Runtime 依赖：

```powershell
python -m pip install -r runtime\requirements.txt
```

启动 Runtime：

```powershell
npm run runtime
```

另开一个终端启动桌面前端开发模式：

```powershell
npm run desktop
```

运行 Tauri 桌面壳：

```powershell
npm run tauri:dev
```

构建本地 release 包：

```powershell
npm run release:local
```

Runtime 默认地址：

- HTTP: `http://127.0.0.1:8765`
- WebSocket: `ws://127.0.0.1:8765/ws/subtitles`

运行数据默认写入用户目录：

- 数据库：`~/.online/runtime.sqlite3`
- 配置：`~/.online/config.json`
- 日志：`~/.online/logs/runtime.log`

可通过环境变量覆盖：

- `ONLINE_DATA_DIR`：覆盖数据目录。
- `ONLINE_RUNTIME_PORT`：覆盖 Runtime 端口，默认 `8765`。

## 项目结构

```text
apps/desktop   Tauri + React 桌面端
runtime        Python FastAPI Runtime
docs           项目方案
```

## 后续接入真实 AI

当前 mock 管线位于 `runtime/app/mock_pipeline.py`。真实实现可在保持前端协议不变的情况下替换为：

- 系统音频采集。
- 流式 ASR provider。
- OpenAI-compatible Chat Completions 翻译 provider。
- 术语表约束注入。

## GitHub Release

推送 `v*` tag 会触发 `.github/workflows/release.yml`，自动在 Windows x64 上构建 PyInstaller Runtime sidecar 和 Tauri 安装包，并上传到 GitHub Releases。

```powershell
git tag v0.1.0
git push origin v0.1.0
```
