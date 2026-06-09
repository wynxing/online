# 构建与部署

本文档描述项目的构建流程、CI/CD 配置和发布流程。

## 构建产物

| 产物 | 说明 |
|------|------|
| Python Runtime sidecar | PyInstaller 打包的独立可执行文件 |
| Tauri NSIS 安装包 | Windows 安装程序（.exe） |
| Tauri MSI 安装包 | Windows Installer 包（.msi） |
| Updater manifest | `latest.json`，用于自动更新检测 |

## 本地构建

### 前置条件

- Node.js 22+
- Python 3.10+
- Rust stable
- 所有依赖已安装

### 构建 Python Runtime Sidecar

```powershell
npm run runtime:sidecar
```

此命令调用 `scripts/build-runtime-sidecar.ps1`，使用 PyInstaller 将 Python Runtime 打包为单个可执行文件，输出到 `apps/desktop/src-tauri/binaries/` 目录。

### 完整本地 Release 构建

```powershell
npm run release:local
```

此命令调用 `scripts/build-release-local.ps1`，依次执行：

1. `npm install` — 安装前端依赖
2. `pip install -r runtime/requirements.txt` — 安装 Python 依赖
3. PyInstaller 构建 sidecar
4. `tauri build` — 构建 Tauri 安装包

输出目录：`build/release/`

## CI/CD

### CI 流水线 (`.github/workflows/ci.yml`)

触发条件：push 或 PR 到 `main` 分支。

**Frontend Job** (ubuntu, Node 22)：

```text
npm install → npm run lint → npm run build → npm run test
```

**Runtime Job** (ubuntu, Python 3.13)：

```text
pip install → ruff check → ruff format --check → pytest --cov
```

### Release 流水线 (`.github/workflows/release.yml`)

触发条件：推送 `v*` tag 或手动触发。

**单 Job** (Windows)：

```text
1. Lint + Test（前端 + Python）
2. PyInstaller 构建 sidecar
3. Tauri build（NSIS + MSI）
4. 生成 latest.json updater manifest
5. 上传所有产物到 GitHub Releases
```

### Updater 机制

应用内置 Tauri updater 插件，启动时检查 GitHub Releases 上的 `latest.json`，发现新版本后提示用户下载安装。

Updater 配置位于 `apps/desktop/src-tauri/tauri.conf.json`：

```json
{
  "plugins": {
    "updater": {
      "pubkey": "...",
      "endpoints": [
        "https://github.com/your-username/ai-simultaneous-interpretation-assistant/releases/latest/download/latest.json"
      ]
    }
  }
}
```

## 发布流程

### 版本号管理

项目遵循 [Semantic Versioning](https://semver.org/)：

- `MAJOR.MINOR.PATCH`（如 `0.2.0`）
- 使用 `npm run version:bump` 脚本更新版本号

### 发布步骤

```powershell
# 1. 确保 main 分支最新
git checkout main
git pull origin main

# 2. 更新版本号
npm run version:bump

# 3. 提交版本变更
git add -A
git commit -m "chore: release v0.2.0"

# 4. 创建 tag 并推送
git tag v0.2.0
git push origin main --tags
```

推送 tag 后，GitHub Actions 自动构建并发布到 Releases。

### 手动触发 Release

可在 GitHub Actions 页面手动触发 `release.yml` workflow。

## 环境变量

| 变量 | 默认值 | 构建时 | 运行时 |
|------|--------|--------|--------|
| `ONLINE_DATA_DIR` | `~/.online/` | ✗ | ✓ |
| `ONLINE_RUNTIME_PORT` | `8765` | ✗ | ✓ |

## 目录约定

| 路径 | 用途 |
|------|------|
| `apps/desktop/src-tauri/binaries/` | PyInstaller sidecar 输出位置 |
| `build/release/` | Tauri 构建产物 |
| `dist/` | 分发输出 |
| `~/.online/` | 运行时数据（SQLite、配置、日志） |
