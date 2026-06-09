# 开发指南

本文档帮助开发者搭建本地开发环境、理解项目结构并进行日常开发。

## 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | 22+ | 前端构建与 npm workspaces |
| Python | 3.10+ | Runtime 后端 |
| Rust | stable | Tauri 桌面壳 |
| npm | 10+ | 包管理 |

## 快速搭建

```powershell
# 1. 克隆仓库
git clone https://github.com/your-username/ai-simultaneous-interpretation-assistant.git
cd ai-simultaneous-interpretation-assistant

# 2. 安装前端依赖
npm install

# 3. 安装 Python 依赖
python -m pip install -r runtime\requirements.txt
python -m pip install -r runtime\requirements-dev.txt

# 4. 安装 Git hooks
npx husky
```

## 日常开发

### 启动服务

需要两个终端：

```powershell
# 终端 1：启动 Python Runtime
npm run runtime

# 终端 2：启动 Tauri 桌面应用
npm run tauri:dev
```

### 仅前端开发

不启动 Tauri 壳，直接用 Vite 开发服务器（需先单独启动 Runtime）：

```powershell
npm run desktop
```

访问 `http://localhost:1420` 查看前端页面。

## 项目结构详解

### 前端 (`apps/desktop/src/`)

```text
src/
├── main.tsx                 # React 入口
├── App.tsx                  # 根组件，路由与全局状态管理
├── types.ts                 # TypeScript 类型定义
├── api.ts                   # HTTP 客户端（Runtime REST API）
├── subtitleState.ts         # 字幕段合并逻辑
├── styles.css               # 全局样式
├── hooks/
│   ├── useSubtitleSocket.ts # WebSocket 连接与事件处理
│   └── useUpdateChecker.ts  # 应用更新检测
├── components/
│   ├── ControlPanel.tsx     # 设备选择、启停控制
│   ├── SubtitlePanel.tsx    # 实时字幕列表
│   ├── FloatingSubtitles.tsx # 悬浮字幕窗口
│   ├── SettingsPanel.tsx    # 配置表单
│   ├── HistoryPanel.tsx     # 会话历史
│   ├── GlossaryPanel.tsx    # 术语表管理
│   └── common/              # 通用组件
├── utils/
│   ├── diagnostics.ts       # 管线诊断数据处理
│   └── format.ts            # 格式化工具
└── test/                    # Vitest 测试
```

### Rust 后端 (`apps/desktop/src-tauri/src/`)

```text
src/
├── main.rs                  # 入口
└── lib.rs                   # Tauri 初始化、sidecar 管理、命令定义
```

Rust 层职责很轻：启动/停止 Python sidecar，暴露 `runtime_status` 和 `restart_runtime` 两个 Tauri 命令。

### Python Runtime (`runtime/app/`)

```text
app/
├── main.py                  # FastAPI 路由定义
├── models.py                # Pydantic 数据模型
├── state.py                 # 运行时状态管理
├── storage.py               # SQLite 存储层
├── devices.py               # 音频设备枚举
├── audio_capture.py         # WASAPI 音频采集
├── segmenter.py             # VAD 音频分段
├── asr_provider.py          # ASR provider（Whisper / Chat）
├── translation_provider.py  # 翻译 provider（OpenAI 兼容）
├── provider_rules.py        # Provider URL 校验规则
├── mock_pipeline.py         # 演示用 mock 管线
├── real_pipeline.py         # 真实管线入口（re-export）
└── pipeline/                # 实时字幕管线
    ├── orchestrator.py      # 管线编排
    ├── segment_processor.py # 音频分段处理
    ├── asr_worker.py        # ASR 并发 worker
    ├── translation_worker.py # 翻译并发 worker
    ├── text_sanitize.py     # ASR 文本清洗
    ├── signal_monitor.py    # 音频信号监控
    ├── constants.py         # 管线调参常量
    └── utils.py             # 共享工具函数
```

## 代码质量

### Lint 与格式化

```powershell
# TypeScript
npm run lint            # ESLint 检查
npm run lint:fix        # ESLint 自动修复

# Python
cd runtime
ruff check app/ tests/  # Ruff 检查
ruff format app/ tests/ # Ruff 格式化
```

### Pre-commit Hooks

Git commit 时自动运行（通过 Husky + lint-staged）：

- TypeScript 文件：ESLint fix + Prettier
- Python 文件：Ruff check fix + Ruff format

手动触发：`npx lint-staged`

## 测试

### 前端测试

```powershell
npm run test              # 单次运行
npm run test:watch        # 监听模式
npm run test:coverage     # 覆盖率报告
```

测试框架：Vitest + Testing Library + jsdom

### Python 测试

```powershell
npm run test:runtime                              # 快速运行
cd runtime && python -m pytest tests/ -v --cov=app  # 详细 + 覆盖率
```

测试框架：pytest + pytest-cov

覆盖率要求：
- 前端：80%+ （新代码）
- Python：60%+ （`pyproject.toml` 配置）

## 调试

### 查看 Runtime 日志

```powershell
# 实时查看日志
Get-Content ~/.online/logs/runtime.log -Wait
```

### 调整管线参数

管线调参常量位于 `runtime/app/pipeline/constants.py`，包括：

- ASR/翻译 worker 并发数
- 队列大小
- 过期片段超时
- 流式翻译阈值
- VAD 能量阈值

### Mock 模式

默认使用 mock 管线（`runtime/app/mock_pipeline.py`），无需真实 AI 服务即可开发前端。Mock 管线模拟 `interim → final → corrected` 完整字幕流。

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```text
<type>: <description>

[optional body]
```

类型：`feat` · `fix` · `refactor` · `docs` · `test` · `chore` · `perf`

示例：

```text
feat: add real-time subtitle export
fix: handle WebSocket reconnection on network loss
refactor: extract audio processing into separate module
```

## 常见问题

### Runtime 启动失败

检查端口是否被占用：

```powershell
netstat -ano | findstr :8765
```

可通过 `ONLINE_RUNTIME_PORT` 环境变量更换端口。

### 前端无法连接 WebSocket

确认 Runtime 已启动且 CSP 配置允许连接。检查 `apps/desktop/src-tauri/tauri.conf.json` 中的 `csp` 字段。

### PyInstaller 打包失败

确保所有依赖已安装且 Python 版本 >= 3.10：

```powershell
python --version
pip install -r runtime\requirements.txt
```
